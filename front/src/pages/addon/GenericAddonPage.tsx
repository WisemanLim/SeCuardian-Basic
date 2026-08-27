import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat } from "../../api/agent";
import { listAddonAgents, type AddonAgent } from "../../api/addonAgents";
import { pickDescription } from "../../store/locale";
import { useLocale } from "../../hooks/useLocale";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export default function GenericAddonPage() {
  const { agentKey } = useParams<{ agentKey: string }>();
  const { t } = useLocale();
  const [agent, setAgent] = useState<AddonAgent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAddonAgents()
      .then((list) => setAgent(list.find((a) => a.agent_key === agentKey) ?? null))
      .catch(() => {});
  }, [agentKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const assistantIdx = messages.length + 1;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setBusy(true);

    try {
      for await (const evt of streamChat(text, history, undefined, agentKey)) {
        if (evt.event === "delta") {
          setMessages((prev) =>
            prev.map((m, i) =>
              i === assistantIdx ? { ...m, content: m.content + evt.data } : m
            )
          );
        } else if (evt.event === "error") {
          setMessages((prev) =>
            prev.map((m, i) =>
              i === assistantIdx
                ? { ...m, content: `⚠️ ${t("chat.error")}: ${evt.data}`, streaming: false }
                : m
            )
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx
            ? { ...m, content: t("chat.errorGeneral"), streaming: false }
            : m
        )
      );
    } finally {
      setMessages((prev) =>
        prev.map((m, i) => (i === assistantIdx ? { ...m, streaming: false } : m))
      );
      setBusy(false);
    }
  }

  const agentName = (agent ? pickDescription(agent.agent_names, agent.agent_name, null) || agent.agent_name : agentKey) ?? "";

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        {/* 에이전트명은 상단 헤더(AppLayout)에 표시 — 본문에는 설명만 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">🤖</span>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {pickDescription(agent?.descriptions, agent?.description, agent?.description_en) || t("chat.addonQaNotice")}
            </p>
            {agent?.api_prefix && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{agent.api_prefix}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setMessages([])}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {t("chat.newSession")}
        </button>
      </div>

      <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/40 shrink-0">
        <p className="text-xs text-blue-600 dark:text-blue-400">{t("chat.addonQaNotice")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-white dark:bg-gray-950">
        {messages.length === 0 && (
          <div className="text-center mt-16 space-y-2">
            <p className="text-3xl">🤖</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">{agentName}</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs">{t("chat.noMessages")}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mr-2 mt-1">
                AI
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
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || (msg.streaming ? "" : t("chat.noResponse"))}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5" />
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
  );
}
