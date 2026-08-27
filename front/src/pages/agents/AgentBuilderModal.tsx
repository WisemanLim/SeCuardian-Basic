import { useEffect, useRef, useState } from "react";
import {
  X, ChevronRight, ChevronLeft, ChevronDown, Download, Zap, AlertCircle, CheckCircle2,
  Upload, Package, BookOpen, Trash2, PackagePlus, Store,
} from "lucide-react";
import {
  scaffoldAgent, uploadAddonAgent, deleteAddonAgent,
  AddonAgent, AddonTemplate, listAddonAgents, listTemplates, getGuide,
  MarketplaceCatalog, MarketplaceAsset, DeployConflict,
  getMarketplaceCatalog, getMarketplaceConfig, deployMarketplaceAsset,
  downloadMarketplaceAsset, checkAgentKey,
  parseDeployError, pickMessage,
} from "../../api/addonAgents";
import { getAuth } from "../../store/auth";
import { pickDescription } from "../../store/locale";
import { upsertMcpConfig } from "../../api/mcpConfig";
import { useLocale } from "../../hooks/useLocale";

interface Props {
  onClose: () => void;
  onDeployed: () => void;
  onChanged?: () => void;
  agentCreateMode?: string;
}

// ── 9종 Agent 유형 정의 ────────────────────────────────────────────────────────

interface AgentTypeDef {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  examples: string;
  hasTemplate: boolean;
  defaultDomain: string;
  previewFiles: string[];
}

const AGENT_TYPES: AgentTypeDef[] = [
  {
    id: "app",
    label: "App Agent",
    emoji: "🖥️",
    desc: "FE + BE + DB 완결형 업무 앱",
    examples: "게시판, 대시보드, CRM",
    hasTemplate: true,
    defaultDomain: "app.default",
    previewFiles: ["{Name}-app.py", "{Name}-front/index.html", "{Name}-sql.sql", "{Name}-meta.json"],
  },
  {
    id: "service",
    label: "Service Agent",
    emoji: "⚙️",
    desc: "백엔드 비즈니스 로직 전용",
    examples: "데이터 처리, 분석, 변환",
    hasTemplate: true,
    defaultDomain: "service.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "tool-proxy",
    label: "Tool Proxy Agent",
    emoji: "🔌",
    desc: "외부 REST API → MCP 어댑터",
    examples: "Slack, Jira, 사내 API 연동",
    hasTemplate: true,
    defaultDomain: "tool.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "rag",
    label: "RAG Agent",
    emoji: "📚",
    desc: "문서 임베딩 + 벡터 검색 Q&A",
    examples: "지식베이스, 매뉴얼 Q&A, HR 정책",
    hasTemplate: true,
    defaultDomain: "knowledge.default",
    previewFiles: ["{Name}-app.py", "{Name}-sql.sql", "{Name}-meta.json"],
  },
  {
    id: "reviewer",
    label: "Reviewer Agent",
    emoji: "🔍",
    desc: "품질 검수·환각 탐지·승인 게이트",
    examples: "코드 리뷰, 문서 검수, 사실 확인",
    hasTemplate: false,
    defaultDomain: "review.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "execution",
    label: "Execution Agent",
    emoji: "▶️",
    desc: "코드 실행·배치 잡·자동화 파이프라인",
    examples: "Python 스크립트, 스케줄 배치, ETL",
    hasTemplate: false,
    defaultDomain: "execution.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "hitl",
    label: "HITL Agent",
    emoji: "👤",
    desc: "사람 승인 게이트웨이 (Human-in-the-Loop)",
    examples: "지출 결재, 콘텐츠 승인, 배포 확인",
    hasTemplate: false,
    defaultDomain: "hitl.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "memory",
    label: "Memory Agent",
    emoji: "🧠",
    desc: "장기 상태·사용자 선호·컨텍스트 관리",
    examples: "개인화, 세션 히스토리, 사용자 프로필",
    hasTemplate: false,
    defaultDomain: "memory.default",
    previewFiles: ["{Name}-app.py", "{Name}-sql.sql", "{Name}-meta.json"],
  },
  {
    id: "federation",
    label: "Federation Agent",
    emoji: "🌐",
    desc: "외부 A2A / MCP Agent 연동 브리지",
    examples: "멀티클라우드 AI, 파트너 Agent 연결",
    hasTemplate: false,
    defaultDomain: "federation.default",
    previewFiles: ["{Name}-app.py", "{Name}-meta.json"],
  },
  {
    id: "shell",
    label: "Shell Agent",
    emoji: "🖥️",
    desc: "서버 상태 점검 CLI/셸 터미널 (읽기 전용)",
    examples: "docker ps, df -h, free, ps aux",
    hasTemplate: true,
    defaultDomain: "ops.server-status",
    previewFiles: ["{Name}-app.py", "{Name}-front.tsx", "{Name}-meta.json"],
  },
];

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

// ── R21: agent_create_mode → 허용 모드 목록 ──────────────────────────────────
// all(기본: 3종 전부) | both(레거시: scaffold+upload) | scaffold | upload | marketplace | 쉼표 조합
type BuilderMode = "build" | "upload" | "market";

const MODE_MAP: Record<string, BuilderMode> = {
  scaffold: "build", build: "build",
  upload: "upload", zip: "upload",
  marketplace: "market", market: "market",
};

function allowedModes(createMode?: string): BuilderMode[] {
  const norm = (createMode || "all").trim().toLowerCase();
  if (norm === "all") return ["build", "upload", "market"];
  if (norm === "both") return ["build", "upload"];
  const modes = [...new Set(
    norm.split(",").map((s) => MODE_MAP[s.trim()]).filter(Boolean)
  )] as BuilderMode[];
  return modes.length > 0 ? modes : ["build", "upload", "market"];
}

// ── 컴포넌트 ───────────────────────────────────────────────────────────────────

export default function AgentBuilderModal({ onClose, onDeployed, onChanged, agentCreateMode = "all" }: Props) {
  const { t, locale } = useLocale();
  const user = getAuth();
  const isAdmin = user?.role === "supervisor" || user?.role === "admin";

  const modes = allowedModes(agentCreateMode);
  const [mode, setMode] = useState<BuilderMode>(modes[0] ?? "build");

  // ── build mode state ────────────────────────────────────────────────────────
  const [step, setStep]             = useState(1);
  const [selectedType, setSelectedType] = useState<AgentTypeDef | null>(null);
  const [agentName, setAgentName]   = useState("");
  const [description, setDesc]      = useState("");
  const [domain, setDomain]         = useState("");
  const [nameError, setNameError]   = useState("");
  // R22-7: 스캐폴드 키 중복 — 이름 단계 사전 경고 + 배포 시 덮어쓰기 확인
  const [nameConflict, setNameConflict] = useState<DeployConflict | null>(null);
  const [scConflict, setScConflict] = useState<DeployConflict | null>(null);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);

  // ── MCP Proxy 옵션 (#3) — REST(OpenAPI) → MCP 변환 ────────────────────────────
  const [enableMcpProxy, setEnableMcpProxy] = useState(false);
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState("");
  const [openapiUrl, setOpenapiUrl] = useState("");
  const [mcpPort, setMcpPort] = useState("");
  const [mcpArgs, setMcpArgs] = useState<{ key: string; val: string }[]>([]);

  // ── upload mode state ───────────────────────────────────────────────────────
  const fileRef                     = useRef<HTMLInputElement>(null);
  const [addons, setAddons]         = useState<AddonAgent[]>([]);
  const [templates, setTemplates]   = useState<AddonTemplate[]>([]);
  const [guideContent, setGuide]    = useState<string | null>(null);
  const [showGuide, setShowGuide]   = useState(false);
  const [showDevSection, setShowDevSection] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk]     = useState<string | null>(null);
  const [deleteKey, setDeleteKey]   = useState<string | null>(null);
  // R22-6: 중복 키(내장 충돌 포함) — 사용자 확인 후에만 덮어쓰기(force) 재요청
  const [conflicts, setConflicts]   = useState<{ file: File; conflict: DeployConflict }[]>([]);

  // ── market mode state (R21) — 마켓플레이스 카탈로그·배포 ─────────────────────
  const [mkCatalog, setMkCatalog]     = useState<MarketplaceCatalog | null>(null);
  const [mkCategory, setMkCategory]   = useState<string>("");   // "" = 전체
  const [mkLoading, setMkLoading]     = useState(false);
  const [mkError, setMkError]         = useState<string | null>(null);
  const [mkOk, setMkOk]               = useState<string | null>(null);
  const [mkDeploying, setMkDeploying] = useState<string | null>(null);  // asset_key
  const [mkDownloading, setMkDownloading] = useState<string | null>(null);  // asset_key (worker zip)
  const [mkBaseUrl, setMkBaseUrl]     = useState<string>("");
  // R22-6: 마켓플레이스 배포 중복 확인
  const [mkConflict, setMkConflict]   = useState<{ asset: MarketplaceAsset; conflict: DeployConflict } | null>(null);

  const userAddons = addons.filter((a) => !a.is_builtin);
  // .omc 등 dot-prefix 시스템 임시 파일은 표시하지 않음
  const visibleTemplates = templates.filter((t) => !t.filename.startsWith("."));

  useEffect(() => {
    listAddonAgents().then(setAddons).catch(() => {});
    listTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode === "market" && !mkCatalog && !mkLoading) void loadMarketplace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function switchMode(m: BuilderMode) {
    setMode(m);
    setError(null); setSuccess(null);
    setUploadError(null); setUploadOk(null); setConflicts([]);
    setMkError(null); setMkOk(null); setMkConflict(null);
  }

  // ── build mode helpers ──────────────────────────────────────────────────────
  function validateName(v: string) {
    if (!v) return "Agent 이름을 입력하세요.";
    if (!NAME_RE.test(v)) return "영문자로 시작, 영문·숫자·_·- 만 허용 (PascalCase 권장)";
    return "";
  }

  function goStep2(type: AgentTypeDef) {
    setSelectedType(type);
    setDomain(type.defaultDomain);
    setStep(2);
  }

  function goStep3() {
    const err = validateName(agentName);
    if (err) { setNameError(err); return; }
    setNameError("");
    // R22-7: 키 중복은 배포 시점이 아니라 이름 단계에서 알린다 (조회 실패는 통과 — 배포 시 재검증)
    void checkAgentKey(agentName)
      .then((r) => setNameConflict(r.available ? null : r.conflict))
      .catch(() => setNameConflict(null));
    setStep(3);
  }

  function previewFiles() {
    return (selectedType?.previewFiles ?? []).map((f) => f.replace(/\{Name\}/g, agentName));
  }

  // MCP proxy 는 tool-proxy 유형 + 토글 ON 일 때만 적용 (#3)
  const mcpProxyActive = () => selectedType?.id === "tool-proxy" && enableMcpProxy;

  function buildMcpExtraArgs(): string[] {
    return mcpArgs
      .map((a) => (a.val.trim() ? `${a.key.trim()}:${a.val.trim()}` : a.key.trim()))
      .filter((s) => s);
  }

  function scaffoldPayload() {
    const base = { agent_name: agentName, agent_type: selectedType!.id, description, domain };
    if (!mcpProxyActive()) return base;
    return {
      ...base,
      enable_mcp_proxy: true,
      upstream_base_url: upstreamBaseUrl.trim(),
      openapi_url: openapiUrl.trim(),
      mcp_extra_args: buildMcpExtraArgs(),
    };
  }

  async function handleDownload() {
    if (!selectedType) return;
    setError(null); setBusy(true);
    try {
      const blob = await scaffoldAgent(scaffoldPayload());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${agentName}.zip`; a.click();
      URL.revokeObjectURL(url);
      setSuccess(`${agentName}.zip 다운로드 완료`);
    } catch (e: unknown) {
      setError((e as Error).message ?? "다운로드 실패");
    } finally { setBusy(false); }
  }

  async function handleDeploy(force = false) {
    if (!selectedType) return;
    setError(null); setScConflict(null); setBusy(true);
    try {
      const blob = await scaffoldAgent(scaffoldPayload());
      const file = new File([blob], `${agentName}.zip`, { type: "application/zip" });
      const result = await uploadAddonAgent(file, force);
      // MCP proxy 활성 시 배포 직후 MCP 설정 자동 등록 (포트·custom args) — #3
      if (mcpProxyActive()) {
        try {
          await upsertMcpConfig(result.agent_key, {
            port: mcpPort.trim() ? Number(mcpPort) : undefined,
            extra_args: buildMcpExtraArgs(),
          });
          setSuccess(`'${result.agent_name}' 배포 + MCP 프록시 등록 완료`);
        } catch {
          setSuccess(`'${result.agent_name}' 배포 완료 (MCP 등록은 에이전트 관리에서 재시도하세요)`);
        }
      } else {
        setSuccess(`'${result.agent_name}' 배포 완료`);
      }
      setNameConflict(null);
      onDeployed();
    } catch (e: unknown) {
      const { conflict, message } = parseDeployError(e);
      // R22-7: 덮어쓰기 가능한 중복은 확인 배너로, 내장 키 충돌은 조치 안내 오류로 표시
      if (conflict?.overwritable) {
        setScConflict(conflict);
      } else {
        setError(conflict ? pickMessage(conflict, locale) : (message ?? (e as Error).message ?? "배포 실패"));
      }
    } finally { setBusy(false); }
  }

  // ── upload mode helpers ─────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError(null); setUploadOk(null); setConflicts([]);
    await runUploads(files.map((f) => ({ file: f, force: false })));
    if (fileRef.current) fileRef.current.value = "";
  }

  /** 업로드 실행 공통 — 409 중복은 확인 대기 목록(conflicts)으로 넘긴다 (R22-6) */
  async function runUploads(items: { file: File; force: boolean }[]) {
    setUploading(true);
    const okMsgs: string[] = [];
    const failMsgs: string[] = [];
    const pending: { file: File; conflict: DeployConflict }[] = [];
    for (let i = 0; i < items.length; i++) {
      const { file, force } = items[i];
      setUploadProgress(items.length > 1 ? `(${i + 1}/${items.length}) ${file.name}` : null);
      try {
        const result = await uploadAddonAgent(file, force);
        okMsgs.push(
          result.is_builtin
            ? `${file.name}: ${pickMessage(result, locale)}`
            : `'${result.agent_name}' ${t("agent.registrationComplete")}`
        );
      } catch (err: unknown) {
        const { conflict, message } = parseDeployError(err);
        // 내장 키 충돌은 등록 불가 — 덮어쓰기 확인 없이 사유를 그대로 오류로 표시
        if (conflict && conflict.code === "builtin_conflict") {
          failMsgs.push(`${file.name}: ${pickMessage(conflict, locale)}`);
        } else if (conflict) {
          pending.push({ file, conflict });
        } else {
          failMsgs.push(`${file.name}: ${message ?? t("agent.uploadFailed")}`);
        }
      }
    }
    if (okMsgs.length > 0) {
      setUploadOk(okMsgs.join("\n"));
      const updated = await listAddonAgents().catch(() => null);
      if (updated) setAddons(updated);
      onChanged?.();
    }
    // 이번 배치 대상만 교체 — 다른 파일의 확인 대기 항목은 유지
    setConflicts((prev) => [
      ...prev.filter((p) => !items.some((i) => i.file === p.file)),
      ...pending,
    ]);
    if (failMsgs.length > 0) setUploadError(failMsgs.join("\n"));
    setUploading(false);
    setUploadProgress(null);
  }

  async function handleOverwrite(item: { file: File; conflict: DeployConflict }) {
    setUploadError(null); setUploadOk(null);
    setConflicts((prev) => prev.filter((c) => c !== item));
    await runUploads([{ file: item.file, force: true }]);
  }

  async function handleDeleteAddon(key: string) {
    try {
      await deleteAddonAgent(key);
      const updated = await listAddonAgents();
      setAddons(updated);
      setDeleteKey(null);
      onChanged?.();
    } catch { /* ignore */ }
  }

  async function handleTemplateDownload(filename: string) {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/addon-agents/templates/download/${filename.replace(".zip", "")}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
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

  // ── market mode helpers (R21) ───────────────────────────────────────────────
  async function loadMarketplace() {
    setMkLoading(true); setMkError(null);
    try {
      const cfg = await getMarketplaceConfig().catch(() => null);
      if (cfg) setMkBaseUrl(cfg.base_url);
      setMkCatalog(await getMarketplaceCatalog());
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMkError(detail ?? t("agent.mkFetchFailed"));
    } finally { setMkLoading(false); }
  }

  // R22-4: worker 패키지 — SeCMP host 직접 접근 대신 서버 프록시 경유 (host API key 는 서버 보유)
  async function handleWorkerDownload(asset: MarketplaceAsset) {
    setMkError(null); setMkOk(null); setMkDownloading(asset.asset_key);
    try {
      const blob = await downloadMarketplaceAsset(asset.asset_key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${asset.asset_key}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMkError(detail ?? t("agent.mkFetchFailed"));
    } finally { setMkDownloading(null); }
  }

  async function handleMarketDeploy(asset: MarketplaceAsset, force = false) {
    setMkDeploying(asset.asset_key); setMkError(null); setMkOk(null);
    try {
      const result = await deployMarketplaceAsset(asset.asset_key, force);
      setMkOk(
        result.is_builtin
          ? pickMessage(result, locale)
          : `'${result.agent_name}' ${t("agent.registrationComplete")}`
      );
      const updated = await listAddonAgents().catch(() => null);
      if (updated) setAddons(updated);
      await loadMarketplace();   // deployed 플래그 갱신
      onDeployed();
      onChanged?.();
    } catch (err: unknown) {
      const { conflict, message } = parseDeployError(err);
      // 덮어쓰기 불가(builtin_conflict)는 확인 배너 없이 조치 안내 오류로 (R22-6/R22-7)
      setMkConflict(conflict?.overwritable ? { asset, conflict } : null);
      setMkError(
        conflict?.overwritable
          ? null
          : (conflict ? pickMessage(conflict, locale) : (message ?? t("agent.uploadFailed")))
      );
    } finally { setMkDeploying(null); }
  }

  // R22-7: 충돌 코드별 배너 제목 — builtin_update(내장 소스 갱신) 포함
  function conflictTitle(c: DeployConflict) {
    if (c.code === "builtin_conflict") return t("agent.conflictBuiltinTitle");
    if (c.code === "builtin_update") return t("agent.conflictBuiltinUpdateTitle");
    return t("agent.conflictDuplicateTitle");
  }

  function assetName(a: MarketplaceAsset) {
    return pickDescription(a.names, a.name, a.name_en) || a.asset_key;
  }

  function assetDesc(a: MarketplaceAsset) {
    return pickDescription(a.descriptions, a.description, null);
  }

  // R22-4: worker 자산(agent_key)이 지원하는 짝 에이전트 — worker 카드에서 바로 배포용
  function pairedAgent(worker: MarketplaceAsset): MarketplaceAsset | null {
    if (!worker.agent_key) return null;
    return (mkCatalog?.assets ?? []).find((x) => x.asset_key === worker.agent_key) ?? null;
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {mode === "build" && <Zap size={20} className="text-blue-600" />}
            {mode === "upload" && <PackagePlus size={20} className="text-blue-500" />}
            {mode === "market" && <Store size={20} className="text-emerald-600" />}
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">새 Agent 만들기</h2>
            {mode === "build" && (
              <div className="flex items-center gap-1 ml-2">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className={`h-1.5 rounded-full transition-all ${
                      n <= step ? "w-6 bg-blue-600" : "w-3 bg-gray-200 dark:bg-gray-700"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs — 허용 모드 2개 이상일 때만 표시 (R21: scaffold/zip/marketplace) */}
        {modes.length > 1 && (
          <div className="flex px-6 pt-3 gap-1 border-b border-gray-100 dark:border-gray-700">
            {modes.includes("build") && (
              <button
                type="button"
                onClick={() => switchMode("build")}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-t-lg transition-colors border-b-2 -mb-px ${
                  mode === "build"
                    ? "border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/10"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                <Zap size={13} />
                스캐폴딩 만들기
              </button>
            )}
            {modes.includes("upload") && (
              <button
                type="button"
                onClick={() => switchMode("upload")}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-t-lg transition-colors border-b-2 -mb-px ${
                  mode === "upload"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                <PackagePlus size={13} />
                ZIP 업로드 등록
              </button>
            )}
            {modes.includes("market") && (
              <button
                type="button"
                onClick={() => switchMode("market")}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-t-lg transition-colors border-b-2 -mb-px ${
                  mode === "market"
                    ? "border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/10"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                <Store size={13} />
                {t("agent.marketplace")}
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* ── BUILD MODE ──────────────────────────────────────────────────── */}
          {mode === "build" && (
            <>
              {/* Step 1: 유형 선택 */}
              {step === 1 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Step 1 — Agent 유형 선택</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">목적에 맞는 유형을 선택하면 스캐폴딩 코드를 자동 생성합니다.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {AGENT_TYPES.map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => goStep2(type)}
                        className="group text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl mt-0.5">{type.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                {type.label}
                              </span>
                              {type.hasTemplate && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
                                  템플릿 있음
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{type.desc}</p>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 italic">{type.examples}</p>
                          </div>
                          <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 group-hover:text-blue-500 shrink-0 mt-1" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: 기본 정보 입력 */}
              {step === 2 && selectedType && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Step 2 — 기본 정보 입력</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-4">
                      <span>{selectedType.emoji}</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">{selectedType.label}</span>
                      <span>·</span>
                      <span>{selectedType.desc}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                      Agent 이름 <span className="text-red-400">*</span>
                      <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(PascalCase 권장)</span>
                    </label>
                    <input
                      type="text"
                      value={agentName}
                      onChange={(e) => {
                        setAgentName(e.target.value);
                        setNameError(""); setNameConflict(null); setScConflict(null);
                      }}
                      placeholder="예: HrPolicyQa"
                      className={`w-full text-sm px-3 py-2 rounded-lg border ${
                        nameError ? "border-red-400 dark:border-red-500" : "border-gray-200 dark:border-gray-600"
                      } bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400`}
                    />
                    {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">설명</label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDesc(e.target.value)}
                      placeholder="예: HR 규정 문서를 검색하고 답변하는 RAG Agent"
                      className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                      도메인 키워드
                      <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(capability taxonomy 분류용)</span>
                    </label>
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      placeholder={selectedType.defaultDomain}
                      className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    />
                  </div>

                  {/* MCP Proxy 옵션 — tool-proxy 유형 전용 (#3) */}
                  {selectedType.id === "tool-proxy" && (
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableMcpProxy}
                          onChange={(e) => setEnableMcpProxy(e.target.checked)}
                          className="w-4 h-4 accent-indigo-600"
                        />
                        <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          MCP 프록시로 생성 (REST API/OpenAPI → MCP 서버 변환)
                        </span>
                      </label>
                      {enableMcpProxy && (
                        <div className="space-y-3 pl-1">
                          <div>
                            <span className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1">Upstream Base URL *</span>
                            <input
                              type="text"
                              value={upstreamBaseUrl}
                              onChange={(e) => setUpstreamBaseUrl(e.target.value)}
                              placeholder="예: https://api.example.com"
                              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1">OpenAPI 스펙 URL (선택)</span>
                            <input
                              type="text"
                              value={openapiUrl}
                              onChange={(e) => setOpenapiUrl(e.target.value)}
                              placeholder="예: https://api.example.com/openapi.json — operation → MCP tool 자동 도출"
                              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1">MCP 포트 (선택 · 배포 시 자동 등록)</span>
                            <input
                              type="number"
                              value={mcpPort}
                              onChange={(e) => setMcpPort(e.target.value)}
                              placeholder="비우면 20000-20019 자동 할당"
                              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Custom Args (헤더/설정 · key:val)</span>
                              <button
                                type="button"
                                onClick={() => setMcpArgs((p) => [...p, { key: "", val: "" }])}
                                className="w-5 h-5 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                              >
                                +
                              </button>
                            </div>
                            {mcpArgs.length === 0 ? (
                              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                예: <code>header.X-Api-Key:secret</code>, <code>Authorization:Bearer ...</code>
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {mcpArgs.map((a, i) => (
                                  <div key={i} className="flex items-center gap-1.5">
                                    <input
                                      className="rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-[44%]"
                                      placeholder="key (예: header.X-Api-Key)"
                                      value={a.key}
                                      onChange={(e) => setMcpArgs((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                                    />
                                    <span className="text-xs text-gray-400">:</span>
                                    <input
                                      className="rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-1"
                                      placeholder="value"
                                      value={a.val}
                                      onChange={(e) => setMcpArgs((p) => p.map((x, j) => (j === i ? { ...x, val: e.target.value } : x)))}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setMcpArgs((p) => p.filter((_, j) => j !== i))}
                                      className="w-6 h-6 rounded border border-gray-200 dark:border-gray-600 text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    >
                                      −
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: 미리보기 */}
              {step === 3 && selectedType && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Step 3 — 스캐폴딩 미리보기</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">생성될 ZIP 구조를 확인하세요.</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{selectedType.emoji}</span>
                      <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{agentName}.zip</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                        {selectedType.id}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {previewFiles().map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <span className="text-gray-300 dark:text-gray-600">📄</span>
                          <code className="font-mono">{f}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      meta.json 미리보기
                    </p>
                    <pre className="text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap">
{JSON.stringify({
  agent_type: selectedType.id,
  version: "1.0.0",
  description: description || `${agentName} — ${selectedType.desc}`,
  capabilities: [{ verb: selectedType.id === "rag" ? "retrieve" : selectedType.id === "tool-proxy" ? "proxy" : "process", domain: domain || selectedType.defaultDomain }],
}, null, 2)}
                    </pre>
                  </div>
                  {!selectedType.hasTemplate && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2.5">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        <strong>{selectedType.label}</strong> 템플릿은 기본 구조로 생성됩니다.
                        다운로드 후 비즈니스 로직을 직접 구현하세요.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: 다운로드 / 배포 */}
              {step === 4 && selectedType && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Step 4 — 다운로드 또는 즉시 배포</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                      <strong>{agentName}.zip</strong> 을 로컬에서 개발 후 업로드하거나, 기본 템플릿을 바로 배포할 수 있습니다.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={busy}
                      className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all disabled:opacity-50"
                    >
                      <Download size={28} className="text-blue-500 dark:text-blue-400" />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">ZIP 다운로드</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">로컬에서 개발 후 업로드</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeploy()}
                      disabled={busy}
                      className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all disabled:opacity-50"
                    >
                      <Zap size={28} className="text-indigo-600 dark:text-indigo-400" />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">바로 배포</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">기본 템플릿으로 즉시 등록</p>
                      </div>
                    </button>
                  </div>
                  {/* R22-7: 키 중복 사전 경고 — 배포 전에 알린다 (내장 충돌은 키 변경만 유효) */}
                  {nameConflict && !scConflict && (
                    <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold">{conflictTitle(nameConflict)}</p>
                        <p className="mt-1 leading-relaxed">{pickMessage(nameConflict, locale)}</p>
                      </div>
                    </div>
                  )}
                  {/* R22-7: 배포 시 확인 가능한 중복 — 덮어쓰기(force) 재요청 */}
                  {scConflict && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                      <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">{conflictTitle(scConflict)}</p>
                          <p className="mt-1 text-xs leading-relaxed">{pickMessage(scConflict, locale)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setScConflict(null)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeploy(true)}
                          disabled={busy}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                        >
                          {t("agent.conflictOverwrite")}
                        </button>
                      </div>
                    </div>
                  )}
                  {busy && (
                    <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                      처리 중...
                    </div>
                  )}
                  {error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                      <AlertCircle size={15} />
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                      <CheckCircle2 size={15} />
                      {success}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── UPLOAD MODE ─────────────────────────────────────────────────── */}
          {mode === "upload" && (
            <div className="space-y-5">

              {/* ZIP 업로드 */}
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
                    <input ref={fileRef} type="file" accept=".zip" multiple className="hidden" onChange={handleFile} disabled={uploading} />
                  </div>
                  {uploading && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-blue-600 dark:text-blue-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                      {t("agent.uploading")}{uploadProgress ? ` ${uploadProgress}` : ""}
                    </div>
                  )}
                  {uploadError && (
                    <div className="flex items-start gap-2 mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 whitespace-pre-line">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      {uploadError}
                    </div>
                  )}
                  {uploadOk && (
                    <div className="flex items-start gap-2 mt-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 whitespace-pre-line">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                      {uploadOk}
                    </div>
                  )}
                  {/* R22-6: 중복 키 확인 — 내장 충돌은 등록 불가 사유를 먼저 안내 */}
                  {conflicts.map((item) => (
                    <div
                      key={item.file.name}
                      className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">
                            {item.file.name} —{" "}
                            {item.conflict.code === "builtin_conflict"
                              ? t("agent.conflictBuiltinTitle")
                              : t("agent.conflictDuplicateTitle")}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed">{pickMessage(item.conflict, locale)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setConflicts((prev) => prev.filter((c) => c !== item))}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => handleOverwrite(item)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                        >
                          {t("agent.conflictOverwrite")}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* 개발 템플릿 다운로드 + 개발 가이드 (접기/펼치기) */}
              <section className="rounded-xl border border-gray-100 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowDevSection((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors"
                >
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t("agent.templates")}
                  </p>
                  {showDevSection
                    ? <ChevronDown size={15} className="text-gray-400 dark:text-gray-500" />
                    : <ChevronRight size={15} className="text-gray-400 dark:text-gray-500" />}
                </button>
                {showDevSection && (
                  <div className="px-4 pb-4 space-y-4">
                    {visibleTemplates.length > 0 && (
                      <div className="space-y-1.5">
                        {visibleTemplates.map((tpl) => (
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
                              onClick={() => handleTemplateDownload(tpl.filename)}
                              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                            >
                              <Download size={13} />
                              {t("agent.download")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 개발 가이드 */}
                    <div>
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
                    </div>
                  </div>
                )}
              </section>

              {/* 등록된 사용자 Agent */}
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
                                  onClick={() => handleDeleteAddon(a.agent_key)}
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
          )}

          {/* ── MARKET MODE (R21) — 마켓플레이스 카테고리별 목록·선택 배포 ──── */}
          {mode === "market" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {t("agent.mkDesc")}
                {mkBaseUrl && <span className="ml-1 font-mono text-gray-300 dark:text-gray-600">({mkBaseUrl})</span>}
              </p>

              {mkLoading && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-500" />
                  {t("common.loading")}
                </div>
              )}
              {mkError && (
                <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 whitespace-pre-line">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  {mkError}
                </div>
              )}
              {mkOk && (
                <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 whitespace-pre-line">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  {mkOk}
                </div>
              )}
              {/* R22-6: 중복 키 확인 — 내장 충돌은 등록 불가 사유를 먼저 안내 */}
              {mkConflict && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                  <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {assetName(mkConflict.asset)} —{" "}
                        {conflictTitle(mkConflict.conflict)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed">{pickMessage(mkConflict.conflict, locale)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setMkConflict(null)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={mkDeploying !== null}
                      onClick={() => { const c = mkConflict; setMkConflict(null); void handleMarketDeploy(c.asset, true); }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                      {t("agent.conflictOverwrite")}
                    </button>
                  </div>
                </div>
              )}

              {mkCatalog && (
                <>
                  {/* 카테고리 필터 */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setMkCategory("")}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                        mkCategory === ""
                          ? "bg-emerald-600 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      {t("agent.mkAll")} ({mkCatalog.total})
                    </button>
                    {mkCatalog.categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setMkCategory(c)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                          mkCategory === c
                            ? "bg-emerald-600 text-white"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                        }`}
                      >
                        {c} ({(mkCatalog.groups[c] ?? []).length})
                      </button>
                    ))}
                  </div>

                  {/* 카테고리별 자산 목록 */}
                  {mkCatalog.total === 0 && (
                    <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{t("agent.mkEmpty")}</p>
                  )}
                  {Object.entries(mkCatalog.groups)
                    .filter(([cat]) => !mkCategory || cat === mkCategory)
                    .map(([cat, assets]) => (
                      <section key={cat}>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                          {cat} ({assets.length})
                        </p>
                        <div className="space-y-2">
                          {assets.map((a) => (
                            <div key={a.asset_key} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{assetName(a)}</span>
                                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{a.asset_key}</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">v{a.version}</span>
                                    {a.agent_type && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">{a.agent_type}</span>
                                    )}
                                    {a.kind === "worker" && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-mono">worker</span>
                                    )}
                                    {a.deployed && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">{t("agent.mkDeployed")}</span>
                                    )}
                                  </div>
                                  {assetDesc(a) && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">{assetDesc(a)}</p>
                                  )}
                                </div>
                                {isAdmin && a.kind === "worker" && (
                                  // R22-4: worker 자산은 hot-deploy 불가 — 다운로드 후 대상 디바이스 설치.
                                  // 짝 에이전트(agent_key)는 같은 카드에서 바로 배포할 수 있게 함께 노출.
                                  <div className="shrink-0 flex items-center gap-2">
                                    {pairedAgent(a) && (
                                      <button
                                        type="button"
                                        onClick={() => handleMarketDeploy(pairedAgent(a)!)}
                                        disabled={mkDeploying !== null}
                                        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                          pairedAgent(a)!.deployed
                                            ? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                                        }`}
                                        title={pairedAgent(a)!.asset_key}
                                      >
                                        {mkDeploying === pairedAgent(a)!.asset_key ? (
                                          <>
                                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                                            {t("agent.mkDeploying")}
                                          </>
                                        ) : (
                                          <>
                                            <Zap size={12} />
                                            {pairedAgent(a)!.deployed
                                              ? t("agent.mkRedeployAgent")
                                              : t("agent.mkDeployAgent")}
                                          </>
                                        )}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void handleWorkerDownload(a)}
                                      disabled={mkDownloading !== null}
                                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                                    >
                                      {t("agent.workerDownload")}
                                    </button>
                                  </div>
                                )}
                                {isAdmin && a.kind !== "worker" && (
                                  <button
                                    type="button"
                                    onClick={() => handleMarketDeploy(a)}
                                    disabled={mkDeploying !== null}
                                    className={`shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                      a.deployed
                                        ? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                                    }`}
                                  >
                                    {mkDeploying === a.asset_key ? (
                                      <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                                        {t("agent.mkDeploying")}
                                      </>
                                    ) : (
                                      <>
                                        <Zap size={12} />
                                        {a.deployed ? t("agent.mkRedeploy") : t("agent.mkDeploy")}
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            {mode === "build" && step > 1 && (
              <button
                type="button"
                onClick={() => { setStep(step - 1); setError(null); setSuccess(null); }}
                className="flex items-center gap-1 text-sm px-3 py-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                <ChevronLeft size={16} />
                이전
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors"
            >
              닫기
            </button>
            {mode === "build" && step === 2 && (
              <button
                type="button"
                onClick={goStep3}
                className="flex items-center gap-1 text-sm px-4 py-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium transition-all"
              >
                다음
                <ChevronRight size={16} />
              </button>
            )}
            {mode === "build" && step === 3 && (
              <button
                type="button"
                onClick={() => setStep(4)}
                className="flex items-center gap-1 text-sm px-4 py-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium transition-all"
              >
                다음
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
