import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getWorkerGuide, WorkerInfo } from "../../api/addonAgents";
import { useLocale } from "../../hooks/useLocale";

/** ReactMarkdown children → plain text (copy 버튼용) */
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

/** R22-3 — 에이전트 활성화 시 worker 배포·설치 가이드 모달 (bundled 는 패키지 다운로드 버튼 포함).
 *  MCP 등록 가이드(McpGuideModal)와 동일한 타이포그래피·섹션 스타일을 적용한다. */
export default function WorkerGuideModal({ agentKey, agentName, onClose }: {
  agentKey: string;
  agentName: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [guide, setGuide] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getWorkerGuide(agentKey)
      .then((res) => {
        setWorker(res.worker);
        setGuide(res.guide);
      })
      .catch(() => setGuide(""))
      .finally(() => setLoading(false));
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

  async function handleDownload() {
    if (!worker?.download_path) return;
    setDownloading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(worker.download_path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = worker.package ?? `${worker.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    } finally {
      setDownloading(false);
    }
  }

  // MCP 가이드와 동일 톤의 마크다운 렌더 스타일 (prose 미사용 — typography 플러그인 없음)
  let preSeq = 0;
  const mdComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="mt-1 text-sm font-bold text-gray-800 dark:text-gray-100">{children}</h4>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h5 className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3 text-[13px] font-bold text-gray-700 dark:text-gray-300">{children}</h5>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h6 className="mt-3 text-[13px] font-semibold text-gray-700 dark:text-gray-300">{children}</h6>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="mt-1.5 list-disc pl-5 text-[13px] text-gray-600 dark:text-gray-400 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="mt-1.5 list-decimal pl-5 text-[13px] text-gray-600 dark:text-gray-400 space-y-1">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{children}</a>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="mt-2 rounded-md border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 [&_p]:mt-0 [&_p]:text-xs [&_p]:text-amber-700 dark:[&_p]:text-amber-400">
        {children}
      </blockquote>
    ),
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      // 블록 코드는 pre 가 감싸므로 여기서는 인라인만 구분해 스타일
      if (className?.includes("language-")) {
        return <code className={className}>{children}</code>;
      }
      return <code className="rounded bg-gray-100 dark:bg-gray-700/60 px-1 py-0.5 font-mono text-[12px] text-purple-600 dark:text-purple-400">{children}</code>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => {
      const text = nodeText(children).replace(/\n$/, "");
      const id = `pre-${preSeq++}`;
      return (
        <div className="relative mt-2 group">
          <pre className="m-0 overflow-auto whitespace-pre rounded-lg bg-slate-900 p-3 pr-16 text-xs leading-relaxed text-slate-200">{children}</pre>
          <button
            type="button"
            onClick={() => copy(id, text)}
            className="absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-md border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {copied === id ? "복사됨 ✓" : "복사"}
          </button>
        </div>
      );
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 px-2 py-1 text-left text-gray-700 dark:text-gray-300">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-gray-600 dark:text-gray-400">{children}</td>
    ),
    hr: () => <hr className="mt-3 border-gray-200 dark:border-gray-700" />,
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header — MCP 가이드와 동일 구성 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t("agent.workerGuideTitle")} — {agentName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {t("common.close")}
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {/* worker 필요 배너 — MCP 상태 배너 톤 */}
          <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
            <span>
              ⚙ <b>{t("agent.workerRequired")}</b>
              {worker?.name && (
                <>
                  {" "}— <code className="font-mono">{worker.name}</code>
                  {worker.version ? ` v${worker.version}` : ""}
                </>
              )}
            </span>
            <span className="mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full bg-amber-400" />
          </div>

          {loading ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">{t("common.loading")}</p>
          ) : guide ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {guide}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-gray-500">{t("agent.workerGuideMissing")}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 shrink-0">
          {worker?.download_path && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
            >
              {downloading ? "…" : t("agent.workerDownload")}
            </button>
          )}
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
