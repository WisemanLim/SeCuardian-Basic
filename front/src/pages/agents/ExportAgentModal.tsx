import { useState } from "react";
import { X, PackageOpen, Container, AlertCircle, Download } from "lucide-react";
import { exportAgent, exportStandalone } from "../../api/addonAgents";
import { useLocale } from "../../hooks/useLocale";

interface Props {
  agentKey: string;
  agentName: string;
  onClose: () => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportAgentModal({ agentKey, agentName, onClose }: Props) {
  const { t } = useLocale();
  const [mode, setMode] = useState<"zip" | "standalone">("zip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // zip export
  const [newName, setNewName] = useState("");
  const [description, setDescription] = useState("");

  // standalone export
  const [a2aPort, setA2aPort] = useState("8001");
  const [mcpPort, setMcpPort] = useState("");
  const [imageName, setImageName] = useState("");

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "zip") {
        const blob = await exportAgent(agentKey, {
          new_name: newName.trim(),
          description: description.trim(),
        });
        downloadBlob(blob, `${newName.trim()}.zip`);
      } else {
        const blob = await exportStandalone(agentKey, {
          a2a_port: Number(a2aPort) || 8001,
          mcp_port: mcpPort ? Number(mcpPort) : null,
          image_name: imageName.trim(),
        });
        downloadBlob(blob, `${agentKey}-standalone.zip`);
      }
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message ?? t("agent.exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  const canRun = mode === "zip" ? /^[A-Za-z][A-Za-z0-9_-]*$/.test(newName.trim()) : !!Number(a2aPort);

  const inputCls =
    "w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <PackageOpen size={20} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {t("agent.export")} — {agentName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("zip")}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              mode === "zip"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <PackageOpen size={13} />
            {t("agent.exportZip")}
          </button>
          <button
            type="button"
            onClick={() => setMode("standalone")}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              mode === "standalone"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Container size={13} />
            {t("agent.exportStandalone")}
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {mode === "zip" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  {t("agent.exportNewName")} *
                </label>
                <input
                  className={inputCls}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="MyDerivedAgent"
                />
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t("agent.exportNameHint")}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  {t("agent.exportDesc")}
                </label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                {t("agent.exportProvenance")}
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {t("agent.exportA2aPort")} *
                  </label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1024}
                    max={65535}
                    value={a2aPort}
                    onChange={(e) => setA2aPort(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {t("agent.exportMcpPort")}
                  </label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1024}
                    max={65535}
                    value={mcpPort}
                    onChange={(e) => setMcpPort(e.target.value)}
                    placeholder="-"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  {t("agent.exportImage")}
                </label>
                <input
                  className={inputCls}
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder={`secuardian-agent-${agentKey}:latest`}
                />
              </div>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                {t("agent.exportBundleHint")}
              </p>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canRun || busy}
            onClick={handleExport}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          >
            {busy
              ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <Download size={14} />}
            {t("agent.exportRun")}
          </button>
        </div>
      </div>
    </div>
  );
}
