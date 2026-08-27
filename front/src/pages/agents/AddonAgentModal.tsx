import { useEffect, useRef, useState } from "react";
import {
  X, Upload, Download, Trash2, PackagePlus,
  AlertCircle, CheckCircle2, Package, ChevronRight, BookOpen,
} from "lucide-react";
import {
  AddonAgent, AddonTemplate,
  listAddonAgents, uploadAddonAgent, deleteAddonAgent,
  listTemplates, getGuide,
} from "../../api/addonAgents";
import { useLocale } from "../../hooks/useLocale";
import { getAuth } from "../../store/auth";

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

export default function AddonAgentModal({ onClose, onChanged }: Props) {
  const { t } = useLocale();
  const user = getAuth();
  const isAdmin = user?.role === "supervisor" || user?.role === "admin";
  const fileRef = useRef<HTMLInputElement>(null);

  const [addons, setAddons]           = useState<AddonAgent[]>([]);
  const [templates, setTemplates]     = useState<AddonTemplate[]>([]);
  const [guideContent, setGuide]      = useState<string | null>(null);
  const [showGuide, setShowGuide]     = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk]       = useState<string | null>(null);
  const [deleteKey, setDeleteKey]     = useState<string | null>(null);

  const userAddons = addons.filter((a) => !a.is_builtin);

  useEffect(() => {
    listAddonAgents().then(setAddons).catch(() => {});
    listTemplates().then(setTemplates).catch(() => {});
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadOk(null);
    setUploading(true);
    try {
      const result = await uploadAddonAgent(file);
      setUploadOk(`'${result.agent_name}' ${t("agent.registrationComplete")}`);
      const updated = await listAddonAgents();
      setAddons(updated);
      onChanged();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setUploadError(detail ?? t("agent.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(key: string) {
    try {
      await deleteAddonAgent(key);
      const updated = await listAddonAgents();
      setAddons(updated);
      setDeleteKey(null);
      onChanged();
    } catch { /* ignore */ }
  }

  async function handleDownload(filename: string) {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/addon-agents/templates/download/${filename.replace(".zip", "")}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleToggleGuide() {
    if (showGuide) { setShowGuide(false); return; }
    if (!guideContent) {
      const content = await getGuide().catch(() => "");
      setGuide(content);
    }
    setShowGuide(true);
  }

  function fmtDate(s?: string) {
    return s ? s.slice(0, 16).replace("T", " ") : "";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <PackagePlus size={20} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{t("agent.register")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

          {/* Upload */}
          {isAdmin && (
            <section>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Agent ZIP {t("common.upload")}
              </p>
              <div
                onClick={() => !uploading && fileRef.current?.click()}
                className="border-2 border-dashed border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload size={28} className="mx-auto text-blue-400 dark:text-blue-500 mb-2" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("agent.uploadHint")}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("agent.uploadHintSub")}</p>
                <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFile} disabled={uploading} />
              </div>

              {uploading && (
                <div className="flex items-center gap-2 mt-2 text-sm text-blue-600 dark:text-blue-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                  {t("agent.uploading")}
                </div>
              )}
              {uploadError && (
                <div className="flex items-center gap-2 mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <AlertCircle size={15} />
                  {uploadError}
                </div>
              )}
              {uploadOk && (
                <div className="flex items-center gap-2 mt-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                  <CheckCircle2 size={15} />
                  {uploadOk}
                </div>
              )}
            </section>
          )}

          {/* Templates */}
          {templates.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {t("agent.templates")}
              </p>
              <div className="space-y-1.5">
                {templates.map((tpl) => (
                  <div
                    key={tpl.filename}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Package size={15} className="text-gray-500 dark:text-gray-400" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{tpl.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{tpl.filename}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(tpl.filename)}
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                    >
                      <Download size={13} />
                      {t("agent.download")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Guide */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t("agent.guide")}
              </p>
              <button
                type="button"
                onClick={handleToggleGuide}
                className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
              >
                <BookOpen size={13} />
                {showGuide ? t("agent.guideHide") : t("agent.guideView")}
              </button>
            </div>
            {!showGuide && (
              <div className="rounded-xl bg-slate-50 dark:bg-gray-800 px-4 py-3 flex items-center gap-2">
                <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("agent.guide")}: <code className="font-mono bg-white dark:bg-gray-700 px-1 rounded text-slate-600 dark:text-slate-300">addon-agents/README.md</code>
                </p>
              </div>
            )}
            {showGuide && guideContent !== null && (
              <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap border border-gray-100 dark:border-gray-700 max-h-64">
                {guideContent || "(내용 없음)"}
              </pre>
            )}
          </section>

          {/* Registered addons */}
          <section>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              {t("agent.registered")} ({userAddons.length})
            </p>
            {userAddons.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{t("agent.noRegistered")}</p>
            ) : (
              <div className="space-y-2">
                {userAddons.map((a) => (
                  <div key={a.agent_key} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{a.agent_name}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{a.agent_key}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {a.has_app && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">app</span>
                          )}
                          {a.has_front && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">front</span>
                          )}
                          <span className="text-xs text-gray-400 dark:text-gray-500">{a.api_prefix}</span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {a.uploaded_by} · {fmtDate(a.uploaded_at)}
                        </p>
                      </div>

                      {isAdmin && (
                        deleteKey === a.agent_key ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDelete(a.agent_key)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                            >
                              {t("agent.deleteConfirm2")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteKey(null)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteKey(a.agent_key)}
                            className="shrink-0 p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title={t("common.delete")}
                          >
                            <Trash2 size={15} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
