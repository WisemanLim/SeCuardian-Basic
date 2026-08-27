/**
 * AI 어시스턴트 질의/응답 전역 스트림 store — 서버 sync.
 *
 * 스트림 소비와 exchange 저장을 컴포넌트(ChatPage) 밖 모듈 스코프에서 수행해
 * 사용자가 다른 메뉴로 이동(언마운트)해도 완주하고, ChatPage 복귀 시
 * 진행 중 교환을 구독해 서버 수신 시점에 갱신 표출한다.
 */
import { streamChat } from "../api/agent";
import { type ChatMeta } from "./sessions";
import { makeTitle } from "./sessions";
import { saveExchange } from "../api/chatHistory";

export interface PendingExchange {
  sessionKey: string;
  question: string;
  content: string;          // 누적 응답 텍스트 (delta 반영)
  streaming: boolean;       // 스트림 진행 중
  saved: boolean;           // 서버 exchange 저장 완료
  saveFailed?: boolean;     // 저장 시도 실패 (최종 상태 판정용)
  meta?: ChatMeta;
  userMsgId?: number;       // 저장 후 서버 메시지 id (피드백 대상)
  assistantMsgId?: number;
  authExpired?: boolean;    // 401 — 구독자가 로그인 화면으로 유도
}

let pending: PendingExchange | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function getPendingExchange(): PendingExchange | null {
  return pending;
}

/** 저장까지 끝난 pending 을 소비(제거) — 복귀한 페이지가 서버 이력으로 대체한 뒤 호출. */
export function clearPendingExchange() {
  if (pending && (!pending.streaming || pending.authExpired)) {
    pending = null;
  }
}

export function subscribeChatStream(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export interface RunExchangeParams {
  sessionKey: string;
  text: string;
  history: { role: string; content: string }[];
  model: string;
  errorLabel: string;         // t("chat.error")
  errorGeneralLabel: string;  // t("chat.errorGeneral")
}

/**
 * 질의 1회 실행 — 스트림 수신 → done 메타 → 서버 exchange 저장까지 완주.
 * 각 단계마다 구독자에게 통지하므로, 페이지가 재마운트되어도 이어서 표출된다.
 */
export async function runExchange(p: RunExchangeParams): Promise<void> {
  if (pending?.streaming) return; // 동시 1건 — 페이지 busy 게이트와 동일 정책

  pending = {
    sessionKey: p.sessionKey,
    question: p.text,
    content: "",
    streaming: true,
    saved: false,
  };
  notify();

  const startedAt = Date.now();

  try {
    for await (const evt of streamChat(p.text, p.history, p.model)) {
      if (!pending) return;
      if (evt.event === "delta") {
        pending = { ...pending, content: pending.content + evt.data };
        notify();
      } else if (evt.event === "done") {
        const raw = evt.raw as { usage?: { input_tokens?: number; output_tokens?: number }; model?: string } | undefined;
        pending = {
          ...pending,
          meta: { elapsedMs: Date.now() - startedAt, usage: raw?.usage, model: raw?.model },
        };
        notify();
      } else if (evt.event === "error") {
        pending = { ...pending, content: `⚠️ ${p.errorLabel}: ${evt.data}` };
        notify();
      }
    }
  } catch (err: unknown) {
    if (!pending) return;
    const msg = (err as { message?: string }).message;
    if (msg?.includes("401")) {
      pending = { ...pending, streaming: false, authExpired: true };
      notify();
      return;
    }
    pending = { ...pending, content: p.errorGeneralLabel };
    notify();
  }

  if (!pending) return;
  pending = { ...pending, streaming: false };
  notify();

  // 서버 DB 영속화 (R18-2) — 페이지 언마운트와 무관하게 저장
  try {
    const saved = await saveExchange(p.sessionKey, {
      title: makeTitle(p.text),
      model: p.model,
      user_content: p.text,
      assistant_content: pending.content,
      latency_ms: pending.meta?.elapsedMs,
      tokens_in: pending.meta?.usage?.input_tokens,
      tokens_out: pending.meta?.usage?.output_tokens,
      assistant_model: pending.meta?.model,
    });
    pending = {
      ...pending,
      saved: true,
      userMsgId: saved.user_message_id,
      assistantMsgId: saved.assistant_message_id,
    };
  } catch {
    // 저장 실패 — 화면 표출은 유지하되 최종 상태로 표시 (다음 교환이 새 쌍으로 추가되도록)
    pending = { ...pending, saveFailed: true };
  }
  notify();
}
