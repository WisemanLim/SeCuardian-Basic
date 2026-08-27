import { useEffect, useRef, useState } from "react";
import { getMcpAgentGuide, McpGuide } from "../../api/addonAgents";
import { getMcpStatus, McpStatusColor } from "../../api/mcpConfig";
import { useLocale } from "../../hooks/useLocale";

function CopyButton({ id, text, copied, onCopy }: { id: string; text: string; copied: string | null; onCopy: (id: string, text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(id, text)}
      className="text-xs px-2.5 py-1 rounded-md border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors shrink-0"
    >
      {copied === id ? "복사됨 ✓" : "복사"}
    </button>
  );
}

interface BlockProps {
  id: string;
  title: string;
  code: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}

function Block({ id, title, code, copied, onCopy }: BlockProps) {
  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <strong className="text-[13px] text-gray-700 dark:text-gray-300">{title}</strong>
        <CopyButton id={id} text={code} copied={copied} onCopy={onCopy} />
      </div>
      <pre className="m-0 overflow-auto whitespace-pre rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{code}</pre>
    </div>
  );
}

const STATUS_DOT: Record<McpStatusColor, string> = {
  green: "bg-green-500",
  orange: "bg-orange-400",
  red: "bg-red-500",
};

interface Props {
  agentKey: string;
  agentName: string;
  onClose: () => void;
}

export default function McpGuideModal({ agentKey, agentName, onClose }: Props) {
  const { t } = useLocale();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<McpGuide | null>(null);
  const [status, setStatus] = useState<McpStatusColor | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Poll both status and guide data every 4s so URL reflects port changes immediately
  useEffect(() => {
    let alive = true;
    let guideLoaded = false;

    const tick = () => {
      getMcpStatus(agentKey)
        .then((s) => { if (alive) setStatus(s.status); })
        .catch(() => {});
      getMcpAgentGuide(agentKey)
        .then((g) => { if (alive) { setGuide(g); guideLoaded = true; } })
        .catch(() => { if (alive && !guideLoaded) setError(true); });
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [agentKey]);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* noop */ }
  }

  const slug = agentKey;
  // Use server_host from guide (actual LAN IP detected by backend).
  // Fall back to window.location.hostname if not provided.
  const proxyUrl = (() => {
    const realHost = guide?.server_host || window.location.hostname;
    if (guide?.proxy_port) {
      return `http://${realHost}:${guide.proxy_port}/mcp`;
    }
    const raw = guide?.mcp_url ?? `http://${realHost}:8000/mcp/${agentKey}`;
    try {
      const u = new URL(raw);
      u.hostname = realHost;
      return u.toString();
    } catch {
      return raw;
    }
  })();

  const claudeConfig = JSON.stringify(
    { mcpServers: { [slug]: { command: "npx", args: ["mcp-remote", proxyUrl] } } },
    null,
    2,
  );
  const cursorConfig = JSON.stringify(
    { mcpServers: { [slug]: { url: proxyUrl } } },
    null,
    2,
  );
  const vscodeConfig = JSON.stringify(
    { name: slug, transport: { type: "http", url: proxyUrl } },
    null,
    2,
  );

  const isRunning = status === "green";
  const isOrange = status === "orange";

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            MCP 등록 가이드 — {agentName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            닫기
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-500">{t("mcp.loadFailed")}</p>}
          {!guide && !error && <p className="text-sm text-gray-400 dark:text-gray-500">{t("common.loading")}</p>}

          {guide && (
            <>
              {/* Step list */}
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                MCP client(Claude Desktop · Cursor) 또는 AI agent에 등록합니다. 아래 순서대로 진행하세요.
              </p>
              <ol className="list-decimal pl-5 text-[13px] text-gray-700 dark:text-gray-300 space-y-1">
                <li>MCP 엔드포인트 URL 확인 (자동 제공 — 별도 설치 불필요)</li>
                <li>Tool 목록 확인 (활성화된 API 자동 노출)</li>
                <li>MCP client 설정에 붙여넣기 (Claude Desktop or Cursor)</li>
              </ol>

              {/* Status banner */}
              {status !== null && (
                isRunning ? (
                  <div className="flex items-start justify-between gap-2 rounded-md border border-green-300 dark:border-green-700/50 bg-green-50 dark:bg-green-900/20 p-3 text-xs text-green-700 dark:text-green-400">
                    <span>
                      ✓ <b>MCP 정상 매핑</b> — <code>{proxyUrl}</code>. 아래 ③ 설정을 MCP 클라이언트에 붙여넣으세요.
                    </span>
                    <span className={`mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full ${STATUS_DOT["green"]}`} />
                  </div>
                ) : isOrange ? (
                  <div className="flex items-start justify-between gap-2 rounded-md border border-orange-300 dark:border-orange-700/50 bg-orange-50 dark:bg-orange-900/20 p-3 text-xs text-orange-700 dark:text-orange-400">
                    <span>⏳ <b>대기/연결 중</b> — 에이전트가 로딩 중입니다. 잠시 후 상태가 갱신됩니다.</span>
                    <span className={`mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full ${STATUS_DOT["orange"]}`} />
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2 rounded-md border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-600 dark:text-red-400">
                    <span>
                      ⚠ <b>MCP 미설정</b> — MCP 설정(수정 버튼)에서 포트 및 인자를 등록하면 활성화됩니다.
                    </span>
                    <span className={`mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full ${STATUS_DOT["red"]}`} />
                  </div>
                )
              )}

              {/* Extra args */}
              {guide.active_tools_count > 0 && guide.active_tools.length > 0 && (
                <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-3 text-xs">
                  <strong className="text-[13px] text-gray-700 dark:text-gray-300">
                    제공 Tool 목록 ({guide.active_tools_count}개)
                  </strong>
                  <ul className="mt-1.5 space-y-0.5">
                    {guide.active_tools.map((tool) => (
                      <li key={tool.name}>
                        <code className="text-purple-600 dark:text-purple-400">{tool.name}</code>
                        {tool.description && (
                          <span className="ml-2 text-gray-500 dark:text-gray-400">{tool.description}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {guide.active_tools_count === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">{t("mcp.noTools")}</p>
              )}

              {/* Custom args (#4) — MCP 응답 config 메타로 노출 */}
              {guide.config && Object.keys(guide.config).length > 0 && (
                <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-xs">
                  <strong className="text-[13px] text-blue-700 dark:text-blue-300">커스텀 인자 (config)</strong>
                  <ul className="mt-1.5 space-y-0.5">
                    {Object.entries(guide.config).map(([k, v]) => (
                      <li key={k}>
                        <code className="text-blue-600 dark:text-blue-400">{k}</code>
                        <span className="ml-2 text-gray-500 dark:text-gray-400">{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    MCP <code>initialize</code> 응답의 <code>_meta.config</code> 및 가이드에 노출됩니다.
                  </p>
                </div>
              )}

              {/* A2A 개방 (#2) — Orchestrator / AI 어시스턴트 */}
              {guide.a2a && (
                <div className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3 text-xs">
                  <strong className="text-[13px] text-indigo-700 dark:text-indigo-300">A2A Protocol 개방</strong>
                  <p className="mt-1 text-gray-600 dark:text-gray-400">
                    이 에이전트는 MCP 외에 A2A Protocol 로도 외부에 개방됩니다.
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    <li>
                      Agent Card: <code className="text-indigo-600 dark:text-indigo-400 break-all">{guide.a2a.agent_card_url}</code>
                    </li>
                    <li>
                      Tasks: <code className="text-indigo-600 dark:text-indigo-400 break-all">{guide.a2a.tasks_endpoint}</code>
                    </li>
                  </ul>
                </div>
              )}

              {/* Code blocks */}
              <Block
                id="url"
                title="① MCP 엔드포인트 URL"
                code={proxyUrl}
                copied={copied}
                onCopy={copy}
              />
              <Block
                id="claude"
                title="② Claude Desktop 설정 (mcp-remote 브리지, npx 필요)"
                code={claudeConfig}
                copied={copied}
                onCopy={copy}
              />
              <Block
                id="cursor"
                title="③ Cursor 등 HTTP 직접 지원 클라이언트"
                code={cursorConfig}
                copied={copied}
                onCopy={copy}
              />
              <Block
                id="vscode"
                title="④ VS Code Continue 설정"
                code={vscodeConfig}
                copied={copied}
                onCopy={copy}
              />

              <p className="text-xs text-gray-400 dark:text-gray-500">
                MCP 서버 = <code>{proxyUrl}</code> (FastAPI 내장). 별도 프록시 프로세스 불필요.
                인증 필요 시 커스텀 인자(수정 버튼)에서 <code>--header:Authorization:Bearer ...</code> 추가.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
