import { useEffect, useState } from "react";
import { listAgentConfigs, patchAgentConfig, AgentConfig } from "../../api/agentConfig";
import {
  listAddonAgents, toggleAddonAgent, deleteAddonAgent, AddonAgent,
} from "../../api/addonAgents";
import {
  getMcpConfig, upsertMcpConfig, getMcpStatus, deleteMcpConfig, McpConfig, McpStatusColor,
} from "../../api/mcpConfig";
import { getUiConfig } from "../../api/settings";
import { getAuth } from "../../store/auth";
import { pickDescription } from "../../store/locale";
import { useLocale } from "../../hooks/useLocale";
import ConfirmDialog from "../../components/ConfirmDialog";
import AgentBuilderModal from "./AgentBuilderModal";
import McpGuideModal from "./McpGuideModal";
import WorkerGuideModal from "./WorkerGuideModal";
import McpEditModal from "./McpEditModal";
import ExportAgentModal from "./ExportAgentModal";

function IcRequired() {
  return (
    <span className="inline-flex items-center border-2 border-red-500 text-red-500 text-[9px] font-black px-1.5 py-0.5 rounded-sm tracking-widest uppercase leading-none select-none font-mono">
      REQUIRED
    </span>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // 색상만으로 상태 표시 (ON/OFF 텍스트 없음)
  return (
    <button
      onClick={() => onChange(!checked)}
      title={checked ? "ON" : "OFF"}
      className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function IcPencil() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086zM11.189 6.25 9.75 4.81 3.198 11.36a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064z" />
    </svg>
  );
}

function IcExport() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z" />
      <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z" />
    </svg>
  );
}

function IcTrash() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916ZM6.5 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

// R22-3: worker 설치 가이드 아이콘 (박스/패키지)
function IcWorker() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5 8.186 1.113ZM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24ZM7.5 14.762V6.838L1 4.239v7.923l6.5 2.6ZM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.63-.928V3.5a.5.5 0 0 1 .314-.464L7.443.184Z" />
    </svg>
  );
}

function McpGlobe({ color, dimmed }: { color?: McpStatusColor; dimmed?: boolean }) {
  const isOnline = color === "green";
  const isOffline = color === "red" || color === "orange";
  const title = isOnline ? "MCP 온라인" : isOffline ? "MCP 오프라인" : "MCP 상태 확인 중";
  const strokeColor = dimmed
    ? "text-gray-300 dark:text-gray-600"
    : isOnline ? "text-green-500" : isOffline ? "text-red-500" : "text-gray-300 dark:text-gray-600";

  return (
    <span className={`relative inline-flex shrink-0 ${!isOnline && !isOffline && !dimmed ? "animate-pulse" : ""}`} title={title}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" className={`w-4 h-4 ${strokeColor}`}>
        <circle cx="8" cy="8" r="6.5" />
        <ellipse cx="8" cy="8" rx="2.6" ry="6.5" />
        <line x1="1.5" y1="8" x2="14.5" y2="8" />
        <line x1="2.2" y1="5.2" x2="13.8" y2="5.2" />
        <line x1="2.2" y1="10.8" x2="13.8" y2="10.8" />
      </svg>
      {isOffline && !dimmed && (
        <svg viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" className="w-4 h-4 absolute inset-0">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      )}
    </span>
  );
}

// 카드덱 아바타 — agent_key 해시 기반 그라디언트 + 이니셜
const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-orange-500 to-amber-600",
  "from-purple-500 to-fuchsia-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
];

function AgentAvatar({ agentKey, name }: { agentKey: string; name: string }) {
  const hash = [...agentKey].reduce((a, c) => a + c.charCodeAt(0), 0);
  const grad = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  const initials = name.replace(/[^A-Za-z0-9가-힣]/g, "").slice(0, 2).toUpperCase() || "AG";
  return (
    <span className={`shrink-0 w-10 h-10 rounded-xl bg-linear-to-br ${grad} flex items-center justify-center text-white text-xs font-bold select-none`}>
      {initials}
    </span>
  );
}

// Orchestrator(general) / AI 어시스턴트(chat) — is_required 이지만 MCP·A2A 로 개방 (#2)
const ORCHESTRATOR_KEYS = new Set(["general", "chat"]);

type Tab = "builtin" | "addon";
type ConfirmTarget =
  | { type: "agent"; key: string; name: string }
  | { type: "mcp"; key: string; name: string };

export default function AgentsPage() {
  const { t, locale } = useLocale();
  const user = getAuth();

  // '언어' 선택에 따른 설명 — en 이면 description_en 우선, 없으면 ko 폴백 (disabled_reason 용)
  const pickDesc = (ko?: string | null, en?: string | null) =>
    locale === "en" ? (en || ko || "") : (ko || "");
  // R18-7: 다국어 dict(descriptions) 우선 + 선호언어 fallback — locale 변경 시 재렌더로 갱신
  const descOf = (o: { descriptions?: Record<string, string> | null; description?: string | null; description_en?: string | null }) =>
    pickDescription(o.descriptions, o.description, o.description_en);
  // R18-7 확장: 에이전트 표시명 다국어 — 동일 fallback 체인
  const nameOf = (o: { agent_names?: Record<string, string> | null; agent_name: string }) =>
    pickDescription(o.agent_names, o.agent_name, null) || o.agent_name;
  const isAdmin = user?.role === "supervisor" || user?.role === "admin";
  // i18n(§7.11.3): DB 한국어 nav_group 값을 locale 라벨로 매핑(미등록 값은 원문 유지)
  const navGroupLabel = (g?: string | null) => {
    if (!g) return t("common.default");
    const m: Record<string, string> = { "기본 Agent": t("agent.groupBasic"), "내장 에이전트": t("agent.groupBuiltin") };
    return m[g] ?? g;
  };

  const [tab, setTab] = useState<Tab>("builtin");
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [addons, setAddons]   = useState<AddonAgent[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [showBuilder, setShowBuilder]       = useState(false);
  const [agentCreateMode, setAgentCreateMode] = useState<string>("all");
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // MCP state
  const [mcpStatus, setMcpStatus]   = useState<Record<string, McpStatusColor>>({});
  const [mcpMenuKey, setMcpMenuKey]   = useState<string | null>(null);
  const [mcpMenuConfig, setMcpMenuConfig] = useState<McpConfig | null>(null);
  const [mcpMenuLoading, setMcpMenuLoading] = useState(false);
  const [mcpGuideKey, setMcpGuideKey] = useState<{ key: string; name: string } | null>(null);
  const [workerGuideKey, setWorkerGuideKey] = useState<string | null>(null);  // R22-3
  const [mcpEditKey, setMcpEditKey]   = useState<{ key: string; name: string } | null>(null);
  // Export (F26/F27) — ZIP/Standalone 모드는 모달 내 탭에서 선택
  const [exportTarget, setExportTarget] = useState<{ key: string; name: string } | null>(null);

  async function loadMcpStatuses(cfgs: AgentConfig[], ads: AddonAgent[]) {
    const keys = [
      ...cfgs
        .filter((c) => (!c.is_required || ORCHESTRATOR_KEYS.has(c.agent_key)) && c.is_enabled)
        .map((c) => c.agent_key),
      ...ads.filter((a) => a.is_active).map((a) => a.agent_key),
    ];
    if (keys.length === 0) return;
    const results = await Promise.allSettled(keys.map((k) => getMcpStatus(k)));
    setMcpStatus((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        next[keys[i]] = r.status === "fulfilled" ? r.value.status : "red";
      });
      return next;
    });
  }

  async function refreshMcpStatus(key: string) {
    try {
      const s = await getMcpStatus(key);
      setMcpStatus((prev) => ({ ...prev, [key]: s.status }));
    } catch { /* noop */ }
  }

  async function reload() {
    const [c, a] = await Promise.all([listAgentConfigs(), listAddonAgents()]);
    setConfigs(c);
    setAddons(a);
    loadMcpStatuses(c, a);
  }

  useEffect(() => {
    reload();
    getUiConfig().then((cfg) => setAgentCreateMode(cfg.agent_create_mode)).catch(() => {});
  }, []);

  async function handleToggle(key: string, enabled: boolean) {
    setLoadingKey(key);
    try {
      const result = await patchAgentConfig(key, { is_enabled: enabled });
      setConfigs((prev) => prev.map((c) => (c.agent_key === key ? { ...c, is_enabled: enabled } : c)));
      window.dispatchEvent(new CustomEvent("agentConfigChanged"));
      refreshMcpStatus(key);
      // R22-3: 활성화 시 worker 필요 에이전트 → 설치 가이드 모달 자동 표시
      if (enabled && result?.worker) setWorkerGuideKey(key);
    } catch { /* ignore */ } finally {
      setLoadingKey(null);
    }
  }

  async function handleDeleteAddon(key: string) {
    try {
      await deleteAddonAgent(key);
      await reload();
      window.dispatchEvent(new CustomEvent("agentConfigChanged"));
    } catch { /* ignore */ }
  }

  async function handleToggleAddon(key: string) {
    setLoadingKey(key);
    try {
      const result = await toggleAddonAgent(key);
      setAddons((prev) => prev.map((a) => (a.agent_key === key ? { ...a, is_active: result.is_active } : a)));
      window.dispatchEvent(new CustomEvent("agentConfigChanged"));
      refreshMcpStatus(key);
      // R22-3: 활성화 시 worker 필요 에이전트 → 설치 가이드 모달 자동 표시
      if (result.is_active && result.worker) setWorkerGuideKey(key);
    } catch { /* ignore */ } finally {
      setLoadingKey(null);
    }
  }

  async function handleMcpDelete(key: string) {
    try {
      await deleteMcpConfig(key);
    } catch { /* might not exist */ }
    setMcpMenuKey(null);
    refreshMcpStatus(key);
  }

  // MCP 메뉴 열기 — 현재 설정 로드 (활성화 토글 상태 표시용)
  async function openMcpMenu(key: string) {
    if (mcpMenuKey === key) {
      setMcpMenuKey(null);
      return;
    }
    setMcpMenuKey(key);
    setMcpMenuConfig(null);
    const cfg = await getMcpConfig(key);
    setMcpMenuConfig(cfg);
  }

  // MCP 활성화 토글 — 기존 port/extra_args 보존, 미설정 시 포트 자동할당
  async function handleMcpToggle(key: string, enabled: boolean) {
    setMcpMenuLoading(true);
    try {
      const saved = await upsertMcpConfig(key, {
        port: mcpMenuConfig?.port ?? null,
        extra_args: mcpMenuConfig?.extra_args ?? [],
        is_enabled: enabled,
      });
      setMcpMenuConfig(saved);
      refreshMcpStatus(key);
    } catch { /* ignore */ } finally {
      setMcpMenuLoading(false);
    }
  }

  // MCP 포트 변경 — null(자동) 이면 20000-20019 중 자동할당
  async function handleMcpPortChange(key: string, port: number | null) {
    setMcpMenuLoading(true);
    try {
      const saved = await upsertMcpConfig(key, {
        port,
        extra_args: mcpMenuConfig?.extra_args ?? [],
        is_enabled: mcpMenuConfig?.is_enabled ?? true,
      });
      setMcpMenuConfig(saved);
      refreshMcpStatus(key);
    } catch { /* ignore */ } finally {
      setMcpMenuLoading(false);
    }
  }

  function handleModalChanged() {
    reload();
    window.dispatchEvent(new CustomEvent("agentConfigChanged"));
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    const { type, key } = confirmTarget;
    setConfirmTarget(null);
    if (type === "agent") await handleDeleteAddon(key);
    else await handleMcpDelete(key);
  }

  const userAddonKeys = new Set(addons.filter((a) => !a.is_builtin).map((a) => a.agent_key));
  const builtinConfigs = configs.filter((c) => !userAddonKeys.has(c.agent_key));
  const userAddons = addons.filter((a) => !a.is_builtin);
  // export 가능 대상 = tbl_addon_agents 에 소스가 등록된 에이전트 (내장 포함) — F26/F27
  const exportableKeys = new Set(addons.map((a) => a.agent_key));
  // R22-3: worker 필요 에이전트 — 카드에 설치 가이드 아이콘 상시 노출
  // (addons 미등록 내장 보안 에이전트도 configs.has_worker 로 커버 — R22-5)
  const workerKeys = new Set([
    ...addons.filter((a) => a.has_worker).map((a) => a.agent_key),
    ...configs.filter((c) => c.has_worker).map((c) => c.agent_key),
  ]);

  // 카드 우상단 MCP 아이콘 + 팝오버 메뉴 (활성화 토글·가이드·설정·삭제)
  function McpCorner({ agentKey, agentName, eligible }: { agentKey: string; agentName: string; eligible: boolean }) {
    const status = mcpStatus[agentKey];
    const open = mcpMenuKey === agentKey;
    const mcpOn = !!mcpMenuConfig?.is_enabled;
    return (
      <div className="relative">
        <button
          type="button"
          disabled={!eligible}
          onClick={() => openMcpMenu(agentKey)}
          className={`p-1.5 rounded-lg border transition-colors ${
            open
              ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 hover:border-blue-300 dark:hover:border-blue-700"
          } ${!eligible ? "opacity-40 cursor-not-allowed" : ""}`}
          title="MCP"
        >
          <McpGlobe color={status} dimmed={!eligible} />
        </button>

        {open && (() => {
          // 레퍼런스 4종 패널: 정상=solid 액센트+✓ 뱃지, 비정상=위험색 아웃라인+✕ 뱃지
          const ok = status === "green";
          const panelCls = ok
            ? "bg-violet-600 dark:bg-violet-700 border border-violet-600 dark:border-violet-700 text-white"
            : "bg-white dark:bg-gray-900 border-2 border-pink-500 text-gray-700 dark:text-gray-200";
          const labelCls = ok ? "text-violet-100" : "text-gray-500 dark:text-gray-400";
          const dividerCls = ok ? "border-violet-500/60" : "border-pink-500/30";
          return (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMcpMenuKey(null)} />
              <div className="absolute right-0 top-9 z-30 w-64">
                {/* 상태 원형 뱃지 — 패널 좌측 모서리 겹침 */}
                <span className={`absolute -left-3.5 top-4 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-lg text-white ${
                  ok ? "bg-violet-500" : "bg-pink-500"
                }`}>
                  {ok ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <path d="M2.5 8.5l3.5 3.5 7-8" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
                      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
                      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
                    </svg>
                  )}
                </span>

                <div className={`rounded-2xl shadow-xl p-3 pl-5 space-y-2 ${panelCls}`}>
                  {/* 헤더: 에이전트명 */}
                  <p className="text-xs font-bold truncate">MCP · {agentName}</p>

                  {/* Row: 활성화 레이블 + 토글 */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs ${labelCls}`}>{t("mcp.enableToggle")}</span>
                    {isAdmin ? (
                      <span className={mcpMenuLoading || mcpMenuConfig === null ? "opacity-50 pointer-events-none" : ""}>
                        <Toggle checked={mcpOn} onChange={(v) => handleMcpToggle(agentKey, v)} />
                      </span>
                    ) : (
                      <span className="text-xs font-semibold">{mcpOn ? "ON" : "OFF"}</span>
                    )}
                  </div>

                  {/* Row: 포트 레이블 + 셀렉트 (자동 / 20000-20019) */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs ${labelCls}`}>{t("mcp.port")}</span>
                    {isAdmin ? (
                      <select
                        value={mcpMenuConfig?.port ?? ""}
                        disabled={mcpMenuLoading || mcpMenuConfig === null}
                        onChange={(e) => handleMcpPortChange(agentKey, e.target.value ? Number(e.target.value) : null)}
                        className={`text-xs rounded-lg px-2 py-1 border focus:outline-none ${
                          ok
                            ? "bg-violet-500/60 border-violet-400 text-white"
                            : "bg-white dark:bg-gray-800 border-pink-400/50 text-gray-700 dark:text-gray-200"
                        } disabled:opacity-50`}
                      >
                        <option value="">{t("mcp.portAuto")}</option>
                        {Array.from({ length: 20 }, (_, i) => 20000 + i).map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-mono">{mcpMenuConfig?.port ?? "—"}</span>
                    )}
                  </div>

                  <div className={`border-t ${dividerCls}`} />

                  {/* Row: 액션 — 가이드 · 설정 · 삭제 */}
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => { setMcpMenuKey(null); setMcpGuideKey({ key: agentKey, name: agentName }); }}
                      className={`flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                        ok ? "hover:bg-violet-500/60" : "hover:bg-pink-500/10"
                      }`}
                    >
                      📖 {t("mcp.guideShort")}
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setMcpMenuKey(null); setMcpEditKey({ key: agentKey, name: agentName }); }}
                          className={`flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                            ok ? "hover:bg-violet-500/60" : "hover:bg-pink-500/10"
                          }`}
                        >
                          <IcPencil /> {t("mcp.editShort")}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMcpMenuKey(null); setConfirmTarget({ type: "mcp", key: agentKey, name: agentName }); }}
                          className={`flex-1 flex items-center justify-center gap-1 text-[11px] px-1.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                            ok ? "text-red-200 hover:bg-red-500/40" : "text-red-500 hover:bg-red-500/10"
                          }`}
                        >
                          <IcTrash /> {t("common.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  // R22-3: worker 설치 가이드 아이콘 — 활성화 여부와 무관하게 상시 노출
  function WorkerCorner({ agentKey }: { agentKey: string }) {
    if (!workerKeys.has(agentKey)) return null;
    return (
      <button
        type="button"
        onClick={() => setWorkerGuideKey(agentKey)}
        className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
        title={t("agent.workerGuideTitle")}
      >
        <IcWorker />
      </button>
    );
  }

  // MCP 우측 — ZIP추출/Standalone 번들 통합 아이콘 (F26/F27, 모드는 모달에서 선택)
  function ExportIcons({ agentKey, agentName }: { agentKey: string; agentName: string }) {
    return (
      <button
        type="button"
        onClick={() => setExportTarget({ key: agentKey, name: agentName })}
        className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        title={t("agent.export")}
      >
        <IcExport />
      </button>
    );
  }

  function BuiltinCard({ c }: { c: AgentConfig }) {
    const mcpEligible = (!c.is_required || ORCHESTRATOR_KEYS.has(c.agent_key)) && !!c.is_enabled;
    const canExport = isAdmin && exportableKeys.has(c.agent_key);
    // REQUIRED(필수) 에이전트는 카드덱 색상을 rose 계열로 구분 — REQUIRED 배지와 톤 일치
    const cardTone = c.is_required
      ? "bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-900/40 hover:border-rose-300 dark:hover:border-rose-800"
      : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800";
    return (
      <div className={`relative rounded-xl border p-4 flex flex-col gap-3 hover:shadow-md transition-all ${cardTone}`}>
        {/* 우상단 컨트롤 행: [REQUIRED|토글] · MCP · [zip 추출 · 독자실행] */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          {c.is_required ? (
            <IcRequired />
          ) : isAdmin ? (
            <Toggle checked={!!c.is_enabled} onChange={(v) => handleToggle(c.agent_key, v)} />
          ) : (
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                c.is_enabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
              title={c.is_enabled ? t("common.active") : t("common.inactive")}
            />
          )}
          <McpCorner agentKey={c.agent_key} agentName={nameOf(c)} eligible={mcpEligible} />
          <WorkerCorner agentKey={c.agent_key} />
          {canExport && <ExportIcons agentKey={c.agent_key} agentName={nameOf(c)} />}
        </div>

        <div className={`flex items-center gap-3 ${canExport ? "pr-32" : "pr-28"}`}>
          <AgentAvatar agentKey={c.agent_key} name={nameOf(c)} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{nameOf(c)}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {c.agent_key} · {navGroupLabel(c.nav_group)}
            </p>
          </div>
        </div>

        <p
          className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-h-8"
          title={[
            descOf(c),
            c.disabled_reason ? `⚠️ ${pickDesc(c.disabled_reason, c.disabled_reason_en)}` : "",
          ].filter(Boolean).join("\n")}
        >
          {descOf(c) || "—"}
        </p>
        {c.disabled_reason && (
          <p className="text-[11px] text-amber-500 line-clamp-1" title={pickDesc(c.disabled_reason, c.disabled_reason_en)}>
            ⚠️ {pickDesc(c.disabled_reason, c.disabled_reason_en)}
          </p>
        )}

        {loadingKey === c.agent_key && (
          <span className="mt-auto text-right text-xs text-gray-400 dark:text-gray-500">{t("common.saving")}</span>
        )}
      </div>
    );
  }

  function AddonCard({ a }: { a: AddonAgent }) {
    return (
      <div className="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all">
        {/* 우상단 컨트롤 행: 토글 · MCP · [zip 추출 · 독자실행] */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          {isAdmin ? (
            <Toggle checked={!!a.is_active} onChange={() => handleToggleAddon(a.agent_key)} />
          ) : (
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                a.is_active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
              title={a.is_active ? t("common.active") : t("common.inactive")}
            />
          )}
          <McpCorner agentKey={a.agent_key} agentName={nameOf(a)} eligible={!!a.is_active} />
          <WorkerCorner agentKey={a.agent_key} />
          {isAdmin && <ExportIcons agentKey={a.agent_key} agentName={nameOf(a)} />}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConfirmTarget({ type: "agent", key: a.agent_key, name: nameOf(a) })}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-700 transition-colors"
              title={t("common.delete")}
            >
              <IcTrash />
            </button>
          )}
        </div>

        <div className={`flex items-center gap-3 ${isAdmin ? "pr-40" : "pr-28"}`}>
          <AgentAvatar agentKey={a.agent_key} name={nameOf(a)} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{nameOf(a)}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{a.api_prefix}</p>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-h-8" title={descOf(a)}>
          {descOf(a) || "—"}
        </p>

        {loadingKey === a.agent_key && (
          <span className="mt-auto text-right text-xs text-gray-400 dark:text-gray-500">{t("common.saving")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {/* 타이틀은 상단 헤더(AppLayout)에 표시 — 본문에는 설명만 */}
      <p className="text-sm text-gray-500 dark:text-gray-400">{t("agent.pageDesc")}</p>

      {/* Tabs: 내장 / ADDON */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1">
          {(["builtin", "addon"] as Tab[]).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === tb
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              {tb === "builtin" ? t("agent.builtin") : t("agent.addon")}
              <span className="ml-1.5 text-[11px] font-normal text-gray-400 dark:text-gray-500">
                {tb === "builtin" ? builtinConfigs.length : userAddons.length}
              </span>
            </button>
          ))}
        </div>
        {tab === "addon" && isAdmin && (
          <button
            type="button"
            onClick={() => setShowBuilder(true)}
            className="mb-1.5 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold transition-all"
          >
            <span>✦</span>
            새 Agent 만들기
          </button>
        )}
      </div>

      {/* Card deck */}
      {tab === "builtin" ? (
        builtinConfigs.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">{t("agent.noAgents")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtinConfigs.map((c) => <BuiltinCard key={c.agent_key} c={c} />)}
          </div>
        )
      ) : userAddons.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t("agent.noAddon")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {userAddons.map((a) => <AddonCard key={a.agent_key} a={a} />)}
        </div>
      )}

      {showBuilder && (
        <AgentBuilderModal
          agentCreateMode={agentCreateMode}
          onClose={() => setShowBuilder(false)}
          onDeployed={() => { setShowBuilder(false); handleModalChanged(); }}
          onChanged={handleModalChanged}
        />
      )}

      {mcpGuideKey && (
        <McpGuideModal
          agentKey={mcpGuideKey.key}
          agentName={mcpGuideKey.name}
          onClose={() => setMcpGuideKey(null)}
        />
      )}

      {/* R22-3: 활성화 시 worker 배포·설치 가이드 */}
      {workerGuideKey && (
        <WorkerGuideModal
          agentKey={workerGuideKey}
          agentName={
            (() => {
              const c = configs.find((x) => x.agent_key === workerGuideKey);
              if (c) return nameOf(c);
              const a = addons.find((x) => x.agent_key === workerGuideKey);
              return a ? nameOf(a) : workerGuideKey;
            })()
          }
          onClose={() => setWorkerGuideKey(null)}
        />
      )}

      {mcpEditKey && (
        <McpEditModal
          agentKey={mcpEditKey.key}
          agentName={mcpEditKey.name}
          onClose={() => setMcpEditKey(null)}
          onSaved={() => refreshMcpStatus(mcpEditKey.key)}
        />
      )}

      {/* Agent 추출/내보내기 — F26/F27 */}
      {exportTarget && (
        <ExportAgentModal
          agentKey={exportTarget.key}
          agentName={exportTarget.name}
          onClose={() => setExportTarget(null)}
        />
      )}

      {/* 커스텀 confirm — 에이전트/MCP 삭제 (R18-1) */}
      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.type === "agent" ? t("agent.deleteTitle") : t("mcp.deleteConfig")}
          message={
            confirmTarget.type === "agent"
              ? t("agent.deleteMessage").replace("{name}", confirmTarget.name)
              : t("mcp.deleteMessage").replace("{name}", confirmTarget.name)
          }
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
}
