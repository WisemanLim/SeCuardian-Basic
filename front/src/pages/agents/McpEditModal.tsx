import { useEffect, useRef, useState } from "react";
import { getMcpConfig, upsertMcpConfig } from "../../api/mcpConfig";
import { useLocale } from "../../hooks/useLocale";

interface Props {
  agentKey: string;
  agentName: string;
  onClose: () => void;
  onSaved: () => void;
}

const inp =
  "w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 transition-colors";

export default function McpEditModal({ agentKey, agentName, onClose, onSaved }: Props) {
  const { t } = useLocale();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [port, setPort] = useState("");
  const [extraArgs, setExtraArgs] = useState<{ key: string; val: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMcpConfig(agentKey)
      .then((cfg) => {
        if (cfg) {
          setPort(cfg.port != null ? String(cfg.port) : "");
          setExtraArgs(
            cfg.extra_args.map((s) => {
              const i = s.indexOf(":");
              return i > 0 ? { key: s.slice(0, i), val: s.slice(i + 1) } : { key: s, val: "" };
            }),
          );
        }
      })
      .finally(() => setLoading(false));
  }, [agentKey]);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ea = extraArgs
        .map((a) => (a.val.trim() ? `${a.key}:${a.val}` : a.key))
        .filter((s) => s.trim());
      const portVal = port.trim()
        ? Number(port)
        : Math.floor(Math.random() * (59999 - 20000 + 1)) + 20000;
      await upsertMcpConfig(agentKey, {
        port: portVal,
        extra_args: ea,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <span className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t("mcp.editTitle")} — {agentName}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-gray-400 dark:text-gray-500">{t("common.loading")}</div>
        ) : (
          <form onSubmit={handleSave}>
            <div className="px-6 py-5 space-y-5">
              {error && <p className="text-sm text-red-500">{error}</p>}

              {/* Port */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  {t("mcp.port")}
                </label>
                <input
                  type="number"
                  min={20000}
                  max={59999}
                  className={inp}
                  placeholder={t("mcp.portPlaceholder")}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>

              {/* Custom Args */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {t("mcp.extraArgs")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setExtraArgs((p) => [...p, { key: "", val: "" }])}
                    className="flex items-center justify-center w-5 h-5 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                  >
                    +
                  </button>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">{t("mcp.extraArgsAuthHint")}</p>
                {extraArgs.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t("mcp.noExtraArgs")}</p>
                ) : (
                  <div className="space-y-2">
                    {extraArgs.map((ea, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          className="rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 w-[44%]"
                          placeholder={t("mcp.argKey")}
                          value={ea.key}
                          onChange={(e) =>
                            setExtraArgs((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                          }
                        />
                        <span className="text-xs text-gray-400 dark:text-gray-500">:</span>
                        <input
                          className="rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 flex-1"
                          placeholder={t("mcp.argVal")}
                          value={ea.val}
                          onChange={(e) =>
                            setExtraArgs((p) => p.map((x, j) => (j === i ? { ...x, val: e.target.value } : x)))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setExtraArgs((p) => p.filter((_, j) => j !== i))}
                          className="flex items-center justify-center w-6 h-6 rounded border border-gray-200 dark:border-gray-600 text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
