import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type FeedbackRating,
  type ServerSession,
  createSuggestion,
  deleteChatSession,
  getChatMessages,
  listChatSessions,
  sendFeedback,
} from "../api/chatHistory";
import { clearAuth } from "../store/auth";
import { listLlmModels } from "../api/llm";
import { useLocale } from "../hooks/useLocale";
import { type ChatMessage, newSessionId } from "../store/sessions";
import {
  clearPendingExchange,
  getPendingExchange,
  runExchange,
  subscribeChatStream,
} from "../store/chatStream";

interface Message extends ChatMessage {
  streaming?: boolean;
  serverId?: number;                       // tbl_chat_messages.id — 피드백 대상 (R18-3)
  rating?: FeedbackRating | null;
  pendingPair?: boolean;                   // 전역 스트림 store 반영 중인 교환 (서버 sync)
}

// R19: 서버 /api/llm/models 로 동적 조회 — 실패 시 아래 기본 옵션 사용
const FALLBACK_MODEL_OPTIONS = [
  { value: "ollama", label: "🏠 Local LLM" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

const FEEDBACK_OPTIONS: { value: FeedbackRating; icon: string }[] = [
  { value: "bad",  icon: "👎" },
  { value: "fine", icon: "😐" },
  { value: "good", icon: "👍" },
];

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function formatDate(ts: number, locale: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return locale.startsWith("ko") ? "어제" : "Yesterday";
  if (diffDays < 7) return locale.startsWith("ko") ? `${diffDays}일 전` : `${diffDays}d ago`;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function sessionTs(s: ServerSession): number {
  const raw = s.updated_at ?? s.created_at;
  const t = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? Date.now() : t;
}

export default function ChatPage() {
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const [sessions, setSessions] = useState<ServerSession[]>([]);
  const [activeId, setActiveId] = useState<string>(() => newSessionId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [model, setModel] = useState<string>("ollama");
  const [modelOptions, setModelOptions] = useState(FALLBACK_MODEL_OPTIONS);

  // R19: 사용 가능 모델 동적 조회 (로컬 provider 라벨 반영)
  useEffect(() => {
    listLlmModels()
      .then((d) => {
        if (d.models?.length) {
          setModelOptions(d.models.map((m) => ({
            value: m.value,
            label: m.provider !== "anthropic" ? `🏠 ${m.label}` : m.label,
          })));
        }
      })
      .catch(() => {});
  }, []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSessions, setShowSessions] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // AppLayout 헤더 우측 슬롯 — 모델 선택·대화 추가를 상단 타이틀 바로 이동
  useEffect(() => {
    setHeaderSlot(document.getElementById("page-header-actions"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 응답 완료(busy=false) 후 disabled 해제된 입력 필드로 포커스 복귀
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const refreshSessions = useCallback(async (): Promise<ServerSession[]> => {
    try {
      const list = await listChatSessions();
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const loadSession = useCallback(async (key: string, sessionModel?: string | null) => {
    setActiveId(key);
    setInput("");
    if (sessionModel) setModel(sessionModel);
    try {
      const rows = await getChatMessages(key);
      setMessages(rows.map((m) => ({
        role: m.role,
        content: m.content,
        serverId: m.id,
        rating: m.rating,
        meta: m.role === "assistant" && (m.latency_ms || m.tokens_in || m.tokens_out || m.model)
          ? {
              elapsedMs: m.latency_ms ?? 0,
              usage: { input_tokens: m.tokens_in ?? undefined, output_tokens: m.tokens_out ?? undefined },
              model: m.model ?? undefined,
            }
          : undefined,
      })));
    } catch {
      setMessages([]);
    }
  }, []);

  // 최초 로드 — 서버 이력에서 세션 목록 + 최신 세션 복원 (R18-2)
  // 진행 중 교환(전역 store)이 있으면 해당 세션을 우선 복원해 이어서 표출 (서버 sync)
  useEffect(() => {
    (async () => {
      const list = await refreshSessions();
      const p = getPendingExchange();
      if (p) {
        const s = list.find((x) => x.session_key === p.sessionKey);
        await loadSession(p.sessionKey, s?.model);
      } else if (list.length > 0) {
        await loadSession(list[0].session_key, list[0].model);
      }
    })();
  }, [refreshSessions, loadSession]);

  // 전역 스트림 store 구독 — 페이지 이탈 후 복귀해도 서버 수신 시점에 갱신 표출 (서버 sync)
  useEffect(() => {
    const apply = () => {
      const p = getPendingExchange();
      setBusy(!!p?.streaming);
      if (!p) return;
      if (p.authExpired) {
        clearPendingExchange();
        clearAuth();
        navigate("/login", { replace: true });
        return;
      }
      if (p.sessionKey !== activeId) return;
      // 최종 상태(저장 완료/실패) — 쌍을 확정(pendingPair 해제)해 다음 교환이 새 쌍으로 추가되게 함
      const settled = p.saved || !!p.saveFailed;
      setMessages((prev) => {
        // 이력 재조회로 이미 저장분이 로드된 경우 — pending 소비만 하고 중복 표출 방지
        if (
          p.saved && p.assistantMsgId &&
          prev.some((m) => !m.pendingPair && m.serverId === p.assistantMsgId)
        ) {
          clearPendingExchange();
          return prev;
        }
        const userB: Message = {
          role: "user", content: p.question, serverId: p.userMsgId, pendingPair: !settled,
        };
        const asstB: Message = {
          role: "assistant", content: p.content, streaming: p.streaming,
          meta: p.meta, serverId: p.assistantMsgId, pendingPair: !settled,
        };
        const idx = prev.findIndex((m) => m.pendingPair && m.role === "assistant");
        if (idx === -1) return [...prev, userB, asstB];
        return prev.map((m, i) => (i === idx - 1 ? userB : i === idx ? asstB : m));
      });
      if (settled) {
        clearPendingExchange();
        if (p.saved) refreshSessions();
      }
    };
    apply(); // 마운트/세션 전환 시 즉시 반영
    return subscribeChatStream(apply);
  }, [activeId, refreshSessions, navigate]);

  function createNewSession() {
    setActiveId(newSessionId());
    setMessages([]);
    setModel("ollama");
    setInput("");
  }

  async function handleDeleteSession(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await deleteChatSession(key);
    } catch { /* ignore */ }
    const remaining = await refreshSessions();
    if (key === activeId) {
      if (remaining.length > 0) {
        loadSession(remaining[0].session_key, remaining[0].model);
      } else {
        createNewSession();
      }
    }
  }

  // 만족도 피드백 (R18-3) — bad/fine/good, 재선택 시 변경
  async function handleFeedback(idx: number, rating: FeedbackRating) {
    const msg = messages[idx];
    if (!msg?.serverId) return;
    const prev = msg.rating;
    setMessages((cur) => cur.map((m, i) => (i === idx ? { ...m, rating } : m)));
    try {
      await sendFeedback(msg.serverId, rating);
    } catch {
      setMessages((cur) => cur.map((m, i) => (i === idx ? { ...m, rating: prev } : m)));
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));
    setInput("");
    setBusy(true);

    // 스트림 수신·done 메타·exchange 저장은 전역 store 가 완주 (서버 sync) —
    // 페이지를 떠나도 계속되고, 진행/완료 표출은 위 구독 effect 가 반영한다.
    void runExchange({
      sessionKey: activeId,
      text,
      history,
      model,
      errorLabel: t("chat.error"),
      errorGeneralLabel: t("chat.errorGeneral"),
    });
  }

  return (
    <div className="relative flex h-full bg-white dark:bg-gray-950">
      {/* Session sidebar */}
      {showSessions && (
        <div className="w-56 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
            <button
              onClick={createNewSession}
              className="flex-1 flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="text-base leading-none">+</span> {t("chat.newSession")}
            </button>
            <button
              onClick={() => setShowSessions(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
              title={t("chat.hideSidebar")}
            >
              ‹
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {sessions.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-600 text-center mt-4">
                {t("chat.noSessions")}
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.session_key}
                onClick={() => loadSession(s.session_key, s.model)}
                className={`group mx-2 mb-0.5 px-3 py-2 rounded-lg cursor-pointer flex items-start justify-between gap-1 transition-colors ${
                  s.session_key === activeId
                    ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">
                    {s.title || t("chat.newSession")}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
                    {formatDate(sessionTs(s), locale)}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(s.session_key, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all text-xs shrink-0 mt-0.5"
                  title={t("chat.deleteSession")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 상단 타이틀 바(AppLayout 헤더) 우측 슬롯 — 모델 선택 + 대화 추가 */}
      {headerSlot && createPortal(
        <>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={createNewSession}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
          >
            {t("chat.addSession")}
          </button>
        </>,
        headerSlot,
      )}

      {/* Chat area */}
      <div className="relative flex flex-col flex-1 min-w-0">
        {/* 사이드바 다시 열기 — 목록 숨김 상태에서만 */}
        {!showSessions && (
          <button
            onClick={() => setShowSessions(true)}
            className="absolute top-2 left-2 z-10 w-6 h-6 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-sm"
            title={t("chat.showSidebar")}
          >
            ›
          </button>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-white dark:bg-gray-950">
          {messages.length === 0 && (
            <div className="text-center mt-16 space-y-2">
              <p className="text-3xl">🤖</p>
              <p className="text-gray-400 dark:text-gray-500 text-sm">
                {t("chat.noMessages")}
              </p>
              <p className="text-gray-300 dark:text-gray-600 text-xs">
                {t("chat.currentModel")}: {modelOptions.find((o) => o.value === model)?.label}
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="h-6 px-2 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mr-2 mt-1 whitespace-nowrap">
                  Genians AI
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm"
                }`}
              >
                {msg.role === "assistant" ? (
                  msg.streaming && !msg.content ? (
                    <TypingDots />
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content || t("chat.noResponse")}
                      </ReactMarkdown>
                    </div>
                  )
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                {/* 응답 생성 중(내용 있음) 커서 — 최초 대기 상태는 TypingDots 가 표시 */}
                {msg.role === "assistant" && msg.streaming && msg.content && (
                  <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5" />
                )}
                {/* 품질 지표 + 만족도 피드백 (R18-3) */}
                {msg.role === "assistant" && !msg.streaming && (
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      {msg.meta ? (
                        <>
                          ⏱ {(msg.meta.elapsedMs / 1000).toFixed(1)}s
                          {msg.meta.usage && (msg.meta.usage.input_tokens || msg.meta.usage.output_tokens) ? (
                            <>
                              {" · "}🔤 {(msg.meta.usage.input_tokens ?? 0) + (msg.meta.usage.output_tokens ?? 0)} 토큰
                              {" (in "}{msg.meta.usage.input_tokens ?? 0}{" · out "}{msg.meta.usage.output_tokens ?? 0}{")"}
                            </>
                          ) : null}
                          {msg.meta.model ? ` · ${msg.meta.model}` : ""}
                        </>
                      ) : null}
                    </p>
                    {msg.serverId && (
                      <div className="flex items-center gap-0.5 shrink-0" title={t("chat.feedbackTitle")}>
                        {FEEDBACK_OPTIONS.map((f) => (
                          <button
                            key={f.value}
                            type="button"
                            onClick={() => handleFeedback(i, f.value)}
                            className={`text-[13px] leading-none px-1 py-0.5 rounded transition-all ${
                              msg.rating === f.value
                                ? "bg-blue-100 dark:bg-blue-900/40 scale-110"
                                : "opacity-40 hover:opacity-100 grayscale hover:grayscale-0"
                            }`}
                            title={t(`chat.feedback.${f.value}`)}
                          >
                            {f.icon}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex gap-2 shrink-0"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder={t("chat.placeholder")}
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 dark:disabled:bg-gray-900"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e as unknown as React.FormEvent);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy ? "…" : t("chat.send")}
          </button>
        </form>
      </div>

      {/* 관리자 건의 floating 버튼 (R18-4) */}
      <button
        type="button"
        onClick={() => setShowSuggest(true)}
        className="absolute bottom-20 right-5 z-20 w-11 h-11 rounded-full bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-lg shadow-lg hover:shadow-xl flex items-center justify-center transition-all"
        title={t("suggest.button")}
      >
        📮
      </button>

      {showSuggest && <SuggestionModal onClose={() => setShowSuggest(false)} />}
    </div>
  );
}

/** 관리자(운영자) 건의 작성 모달 — 1차: DB 저장 (R18-4) */
function SuggestionModal({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      await createSuggestion(title.trim(), content.trim());
      setDone(true);
      setTimeout(onClose, 1200);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">📮 {t("suggest.title")}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
        </div>

        {done ? (
          <p className="text-sm text-green-600 dark:text-green-400 py-6 text-center">✓ {t("suggest.submitted")}</p>
        ) : (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t("suggest.subjectPlaceholder")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder={t("suggest.contentPlaceholder")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            {error && <p className="text-xs text-red-500">{t("suggest.failed")}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim() || !content.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white font-semibold transition-colors"
              >
                {submitting ? "…" : t("suggest.submit")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
