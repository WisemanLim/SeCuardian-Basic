/**
 * ShellAgent — 서버 상태 점검용 CLI/셸 터미널 프론트엔드
 *
 * API prefix 는 라우트의 agentKey 에서 동적으로 도출 → 이름 변경(rename)에도 안전
 * 다크 모드: Tailwind dark: 클래스 (앱 테마와 자동 동기화)
 * 독립형 i18n: localStorage "locale" 키 사용
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import client from "../../../api/client";

// ─── i18n ────────────────────────────────────────────────────────────────────

const LOCALE: Record<string, Record<string, string>> = {
  ko: {
    desc: "서버 상태를 점검하는 진단 셸입니다 (읽기 전용 명령만 허용).",
    placeholder: "명령 입력 후 Enter (예: docker ps)",
    run: "실행",
    running: "실행 중…",
    clear: "지우기",
    presets: "빠른 명령",
    exit: "종료 코드",
    empty: "명령을 실행하면 결과가 여기에 표시됩니다.",
    allowed: "허용 명령",
  },
  en: {
    desc: "Diagnostic shell for checking server status (read-only commands only).",
    placeholder: "Type a command and press Enter (e.g. docker ps)",
    run: "Run",
    running: "Running…",
    clear: "Clear",
    presets: "Quick commands",
    exit: "exit code",
    empty: "Run a command to see output here.",
    allowed: "Allowed",
  },
};

function useShellLocale() {
  const [locale, setLocale] = useState(() => localStorage.getItem("locale") || "ko");
  useEffect(() => {
    const handler = () => setLocale(localStorage.getItem("locale") || "ko");
    window.addEventListener("localeChanged", handler);
    return () => window.removeEventListener("localeChanged", handler);
  }, []);
  return (k: string) => LOCALE[locale]?.[k] ?? LOCALE.ko[k] ?? k;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Preset {
  label: string;
  cmd: string;
}

interface ExecResult {
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

interface HistoryEntry extends ExecResult {
  ts: string;
}

function parseApiError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { response?: { status?: number; data?: { detail?: string } } };
    const detail = e.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    const status = e.response?.status;
    if (status === 403) return "권한이 없습니다 (supervisor/admin 전용).";
    if (status === 504) return "명령 실행 시간이 초과되었습니다.";
    if (status) return `오류가 발생했습니다. (HTTP ${status})`;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ShellAgentPage() {
  const t = useShellLocale();
  const { agentKey } = useParams<{ agentKey: string }>();
  const BASE = `/addon/${agentKey}`;

  const [presets, setPresets] = useState<Preset[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    client
      .get<{ presets: Preset[] }>(`${BASE}/presets`)
      .then(({ data }) => setPresets(data.presets ?? []))
      .catch(() => {});
  }, [BASE]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function run(command: string) {
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await client.post<ExecResult>(`${BASE}/exec`, { command: cmd });
      setHistory((prev) => [...prev, { ...data, ts: new Date().toLocaleTimeString() }]);
      setInput("");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* 상단 설명 + 프리셋 */}
      <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-base shrink-0">🖥️</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("desc")}</p>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => run(p.cmd)}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                title={p.cmd}
              >
                {p.label}
              </button>
            ))}
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="text-xs px-2.5 py-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-auto transition-colors"
              >
                {t("clear")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 출력 (터미널 스타일) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-black/40 font-mono text-xs">
        {history.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 text-center mt-16">{t("empty")}</p>
        )}
        {history.map((h, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <span className="text-blue-600 dark:text-blue-400 truncate">$ {h.command}</span>
              <span className={`shrink-0 ml-2 ${h.exit_code === 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {t("exit")}: {h.exit_code}
              </span>
            </div>
            {h.stdout && (
              <pre className="px-3 py-2 whitespace-pre-wrap break-all text-gray-800 dark:text-gray-200">{h.stdout}</pre>
            )}
            {h.stderr && (
              <pre className="px-3 py-2 whitespace-pre-wrap break-all text-red-500 dark:text-red-400 border-t border-gray-100 dark:border-gray-800">{h.stderr}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mx-4 mb-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* 입력 */}
      <form
        onSubmit={(e) => { e.preventDefault(); run(input); }}
        className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex gap-2 shrink-0"
      >
        <span className="self-center text-sm text-gray-400 font-mono select-none">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder={t("placeholder")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 dark:disabled:bg-gray-900"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors"
        >
          {busy ? t("running") : t("run")}
        </button>
      </form>
    </div>
  );
}
