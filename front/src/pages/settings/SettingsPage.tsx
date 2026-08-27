import { useEffect, useState } from "react";
import { getSettings, updateSetting, testLlm, Setting } from "../../api/settings";
import { getLlmUsage, LlmUsageRow } from "../../api/llm";
import { getAuth } from "../../store/auth";
import { useLocale } from "../../hooks/useLocale";

const EDITABLE_KEYS = [
  "orchestrator_model",
  "domain_agent_model",
  "ollama_base_url",
  "ollama_model",
  "fallback_enabled",
  // R19: Local LLM 다중 백엔드 + 라우팅 + 토큰 예산
  "local_llm_provider",
  "llamacpp_base_url",
  "llamacpp_model",
  "vllm_base_url",
  "vllm_model",
  "llm_routes",
  "llm_context_budget",
  "llm_tool_max_rounds",
];

export default function SettingsPage() {
  const { t } = useLocale();
  const user = getAuth();
  const isAdmin = user?.role === "supervisor" || user?.role === "admin";

  const [settings, setSettings] = useState<Setting[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ollama: boolean; anthropic_configured: boolean } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [sysInstr, setSysInstr] = useState("");
  const [sysInstrSaved, setSysInstrSaved] = useState(false);
  const [sysInstrSaving, setSysInstrSaving] = useState(false);
  const [userCommonInstr, setUserCommonInstr] = useState("");
  const [userCommonInstrSaved, setUserCommonInstrSaved] = useState(false);
  const [userCommonInstrSaving, setUserCommonInstrSaving] = useState(false);
  const [llmUsage, setLlmUsage] = useState<LlmUsageRow[]>([]);
  // '사용자 맞춤지침 (개인화)' 는 마이페이지 '맞춤지침' 과 중복 — 시스템 설정에서 제거 (R18-5)

  useEffect(() => {
    getSettings().then((data) => {
      setSettings(data);
      const sysRow = data.find((s) => s.key === "system_custom_instructions");
      if (sysRow) setSysInstr(sysRow.value ?? "");
      const ucRow = data.find((s) => s.key === "user_custom_instructions");
      if (ucRow) setUserCommonInstr(ucRow.value ?? "");
    }).catch(console.error);
    // R19-3: LLM 사용량 요약 (admin 전용 API — 실패 무시)
    if (isAdmin) {
      getLlmUsage("model", 30).then((d) => setLlmUsage(d.rows ?? [])).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveSysInstr() {
    setSysInstrSaving(true);
    try {
      await updateSetting("system_custom_instructions", sysInstr, "System custom instructions");
      setSysInstrSaved(true);
      setTimeout(() => setSysInstrSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSysInstrSaving(false);
    }
  }

  async function handleSaveUserCommonInstr() {
    setUserCommonInstrSaving(true);
    try {
      await updateSetting("user_custom_instructions", userCommonInstr, "사용자 공통 맞춤지침 (Supervisor가 정의하는 사용자 공통 제약·지침)");
      setUserCommonInstrSaved(true);
      setTimeout(() => setUserCommonInstrSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setUserCommonInstrSaving(false);
    }
  }

  function startEdit(key: string, value: string) {
    setEditing((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(key: string, description: string) {
    const value = editing[key];
    if (value === undefined) return;
    try {
      await updateSetting(key, value, description);
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
      setEditing((p) => { const next = { ...p }; delete next[key]; return next; });
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } catch { /* ignore */ }
  }

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testLlm();
      setTestResult(result);
    } catch {
      setTestResult({ ollama: false, anthropic_configured: false });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        {/* 타이틀은 상단 헤더(AppLayout)에 표시 — 본문에는 설명만 */}
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("settings.pageDesc")}</p>
        <button
          onClick={handleTest}
          disabled={testLoading}
          className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {testLoading ? t("common.testing") : t("settings.testLlm")}
        </button>
      </div>

      {testResult && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm space-y-1">
          <p className={testResult.ollama ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}>
            Ollama: {testResult.ollama ? t("settings.ollamaConnected") : t("settings.ollamaFailed")}
          </p>
          <p className={testResult.anthropic_configured ? "text-green-600 dark:text-green-400" : "text-amber-500 dark:text-amber-400"}>
            Anthropic API Key: {testResult.anthropic_configured ? t("settings.anthropicConfigured") : t("settings.anthropicMissing")}
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {settings.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 px-4 py-4">{t("settings.noSettings")}</p>
        )}
        {settings.filter((s) => !["system_custom_instructions", "user_custom_instructions"].includes(s.key)).map((s) => {
          const isEditing = s.key in editing;
          const canEdit = isAdmin && EDITABLE_KEYS.includes(s.key);
          return (
            <div key={s.key} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-0.5">{s.key}</p>
                  {s.description && <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{s.description}</p>}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editing[s.key]}
                      onChange={(e) => setEditing((p) => ({ ...p, [s.key]: e.target.value }))}
                      className="w-full border border-blue-300 dark:border-blue-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm text-gray-800 dark:text-gray-200 font-mono truncate">{s.value || "—"}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-2 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleSave(s.key, s.description)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          {saved === s.key ? t("common.saved") : t("common.save")}
                        </button>
                        <button
                          onClick={() => setEditing((p) => { const n = { ...p }; delete n[s.key]; return n; })}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEdit(s.key, s.value)}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {t("common.edit")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* LLM usage summary (R19-3, Admin+) */}
      {isAdmin && llmUsage.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📊 {t("settings.llmUsage")}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("settings.llmUsageDesc")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-1.5 pr-3 font-medium">{t("settings.llmUsageModel")}</th>
                  <th className="py-1.5 pr-3 font-medium text-right">{t("settings.llmUsageCalls")}</th>
                  <th className="py-1.5 pr-3 font-medium text-right">{t("settings.llmUsageTokensIn")}</th>
                  <th className="py-1.5 pr-3 font-medium text-right">{t("settings.llmUsageTokensOut")}</th>
                  <th className="py-1.5 font-medium text-right">{t("settings.llmUsageLatency")}</th>
                </tr>
              </thead>
              <tbody>
                {llmUsage.map((r) => (
                  <tr key={r.grp} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-700 dark:text-gray-300">
                    <td className="py-1.5 pr-3 font-mono">{r.grp || "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{r.calls.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{(r.tokens_in ?? 0).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{(r.tokens_out ?? 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right">{r.avg_latency_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System custom instructions (Admin+) */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("settings.systemInstructions")}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("settings.systemInstructionsDesc")}</p>
          </div>
          <textarea
            value={sysInstr}
            onChange={(e) => setSysInstr(e.target.value)}
            rows={5}
            placeholder={t("settings.systemInstructionsPlaceholder")}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={handleSaveSysInstr}
            disabled={sysInstrSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {sysInstrSaved ? t("common.saved") : sysInstrSaving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}

      {/* User common instructions (Admin+) */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("settings.userCommonInstructions")}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("settings.userCommonInstructionsDesc")}</p>
          </div>
          <textarea
            value={userCommonInstr}
            onChange={(e) => setUserCommonInstr(e.target.value)}
            rows={4}
            placeholder={t("settings.userCommonInstructionsPlaceholder")}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={handleSaveUserCommonInstr}
            disabled={userCommonInstrSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {userCommonInstrSaved ? t("common.saved") : userCommonInstrSaving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}

    </div>
  );
}
