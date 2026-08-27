import axios from "axios";
import client from "./client";

export interface AddonAgent {
  id: number;
  agent_key: string;
  agent_name: string;
  api_prefix: string;
  has_app: boolean;
  has_front: boolean;
  is_builtin: boolean;
  is_active: boolean;
  has_worker?: boolean;          // R22-3: worker 필요 — 카드 설치 가이드 아이콘 상시 노출
  description?: string;
  description_en?: string;
  descriptions?: Record<string, string> | null;
  agent_names?: Record<string, string> | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export async function listAddonAgents(): Promise<AddonAgent[]> {
  const { data } = await client.get<{ addons: AddonAgent[] }>("/addon-agents/");
  return data.addons ?? [];
}

export interface DeployResult {
  agent_key: string;
  agent_name: string;
  message: string;
  message_en?: string;
  is_builtin?: boolean;
  is_active?: boolean;
  version?: string;
  category?: string;
}

/** R22-6 — 중복 키 409 상세 (내장 키 충돌 / 기존 등록 중복) */
export interface DeployConflict {
  // R22-7: builtin_update = 마켓플레이스 경로의 내장 소스 갱신(확인 후 force 재요청 가능)
  code: "duplicate" | "builtin_conflict" | "builtin_update";
  agent_key: string;
  is_builtin: boolean;
  registered: boolean;
  overwritable?: boolean;   // R22-6/R22-7: 사용자 확인(force) 후 덮어쓰기 가능 여부
  message: string;
  message_en?: string;
}

/** 409 구조화 detail 이면 conflict, 그 외에는 문자열 메시지로 정규화 */
export function parseDeployError(err: unknown): { conflict?: DeployConflict; message?: string } {
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  if (detail && typeof detail === "object" && "code" in (detail as Record<string, unknown>)) {
    return { conflict: detail as DeployConflict };
  }
  return { message: typeof detail === "string" ? detail : undefined };
}

/** locale 에 맞는 메시지 선택 (en 없으면 ko 폴백) */
export function pickMessage(
  o: { message: string; message_en?: string } | undefined,
  locale: string
): string {
  if (!o) return "";
  return locale === "en" ? (o.message_en || o.message) : o.message;
}

// R22-7: 스캐폴드 이름(= 에이전트 키) 사전 중복 확인 — 배포 전에 알린다
export async function checkAgentKey(
  agentKey: string
): Promise<{ agent_key: string; available: boolean; conflict: DeployConflict | null }> {
  const { data } = await client.get(`/addon-agents/key-check/${encodeURIComponent(agentKey)}`);
  return data;
}

export async function uploadAddonAgent(file: File, force = false): Promise<DeployResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("force", String(force));
  const { data } = await client.post("/addon-agents/upload", form);
  return data;
}

// R22-3: worker 필요 에이전트 요약 (활성화 응답·가이드 응답 공용)
export interface WorkerInfo {
  required: boolean;
  kind: "bundled" | "external";
  name: string;
  version?: string;
  guide_path: string;
  package?: string;
  download_path?: string;
}

export async function toggleAddonAgent(
  key: string
): Promise<{ agent_key: string; is_active: boolean; worker?: WorkerInfo }> {
  const { data } = await client.patch(`/addon-agents/${key}/toggle`);
  return data;
}

/** R22-3 — worker 설치 가이드(markdown) + worker 요약 조회 */
export async function getWorkerGuide(
  key: string
): Promise<{ agent_key: string; worker: WorkerInfo; guide: string }> {
  const { data } = await client.get(`/addon-agents/${key}/worker-guide`);
  return data;
}

export async function deleteAddonAgent(key: string): Promise<void> {
  await client.delete(`/addon-agents/${key}`);
}

export interface AddonTemplate {
  name: string;
  filename: string;
}

export async function listTemplates(): Promise<AddonTemplate[]> {
  const { data } = await client.get<{ templates: AddonTemplate[] }>("/addon-agents/templates/list");
  return data.templates ?? [];
}

export async function getGuide(): Promise<string> {
  const { data } = await client.get<{ content: string }>("/addon-agents/guide");
  return data.content ?? "";
}

export async function patchAddonAgent(
  key: string,
  body: { agent_name?: string }
): Promise<void> {
  await client.patch(`/addon-agents/${key}`, body);
}

export interface ScaffoldRequest {
  agent_name: string;
  agent_type: string;
  description?: string;
  domain?: string;
  // MCP Proxy 옵션 (#3) — REST API(OpenAPI)를 MCP 서버로 변환
  enable_mcp_proxy?: boolean;
  upstream_base_url?: string;
  openapi_url?: string;
  mcp_extra_args?: string[];
}

export async function scaffoldAgent(req: ScaffoldRequest): Promise<Blob> {
  const token = localStorage.getItem("token");
  const res = await fetch("/api/addon-agents/scaffold", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Scaffold failed");
  }
  return res.blob();
}

async function postForBlob(url: string, body: object): Promise<Blob> {
  const token = localStorage.getItem("token");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Export failed");
  }
  return res.blob();
}

export interface ExportRequest {
  new_name: string;
  description?: string;
}

/** F26 — 내장/ADDON 에이전트를 새 이름 ZIP으로 추출 (base 출처 자동 명시) */
export async function exportAgent(key: string, req: ExportRequest): Promise<Blob> {
  return postForBlob(`/api/addon-agents/${key}/export`, req);
}

export interface StandaloneExportRequest {
  a2a_port: number;
  mcp_port?: number | null;
  image_name?: string;
}

/** F27 — Standalone 배포 번들(Dockerfile/compose/.env 자동생성) ZIP */
export async function exportStandalone(key: string, req: StandaloneExportRequest): Promise<Blob> {
  return postForBlob(`/api/addon-agents/${key}/export-standalone`, req);
}

export interface CatalogEntry {
  agent_key: string;
  agent_name: string;
  api_prefix: string;
  agent_type: string;
  is_active: boolean;
}

export async function getCatalog(agentType?: string): Promise<Record<string, CatalogEntry[]>> {
  const url = agentType ? `/addon-agents/catalog?agent_type=${agentType}` : "/addon-agents/catalog";
  const { data } = await client.get<{ catalog: Record<string, CatalogEntry[]> }>(url);
  return data.catalog ?? {};
}

// ── R21: Marketplace 배포 — SeCMP host 카탈로그 조회·선택 배포 ─────────────────

export interface MarketplaceAsset {
  asset_key: string;
  name: string;
  name_en?: string;
  names?: Record<string, string> | null;
  description?: string;
  descriptions?: Record<string, string> | null;
  version: string;
  kind?: string;                 // R22-4: "agent" | "worker"
  agent_key?: string;            // R22-4: worker 자산이 지원하는 짝 에이전트 asset_key
  agent_type?: string;
  category: string;
  size?: number;
  checksum?: string;
  deployed?: boolean;
}

export interface MarketplaceCatalog {
  total: number;
  categories: string[];
  groups: Record<string, MarketplaceAsset[]>;
  assets: MarketplaceAsset[];
}

export async function getMarketplaceConfig(): Promise<{
  enabled: boolean; base_url: string; host: string; port: number;
}> {
  const { data } = await client.get("/addon-agents/marketplace/config");
  return data;
}

export async function getMarketplaceCatalog(category?: string): Promise<MarketplaceCatalog> {
  const url = category
    ? `/addon-agents/marketplace/catalog?category=${encodeURIComponent(category)}`
    : "/addon-agents/marketplace/catalog";
  const { data } = await client.get<MarketplaceCatalog>(url);
  return data;
}

// R22-4: worker 패키지는 서버 프록시 경유 다운로드 (host API key 는 서버만 보유)
export async function downloadMarketplaceAsset(assetKey: string): Promise<Blob> {
  const { data } = await client.get<Blob>(
    `/addon-agents/marketplace/download/${encodeURIComponent(assetKey)}`,
    { responseType: "blob" }
  );
  return data;
}

export async function deployMarketplaceAsset(
  assetKey: string,
  force = false
): Promise<DeployResult> {
  const { data } = await client.post("/addon-agents/marketplace/deploy", {
    asset_key: assetKey, force,
  });
  return data;
}

export interface McpTool {
  name: string;
  description: string;
}

export interface McpClientConfig {
  description: string;
  config: object;
}

export interface McpGuide {
  agent_key: string;
  mcp_url: string;
  proxy_port: number | null;
  server_host?: string;
  is_alive: boolean;
  transport: string;
  protocol: string;
  active_tools_count: number;
  active_tools: McpTool[];
  client_configs: Record<string, McpClientConfig>;
  extra_args?: string[];                                   // custom args 원본 (#4)
  config?: Record<string, string | boolean>;              // key:val 파싱 설정 메타 (#4)
  is_orchestrator?: boolean;                               // Orchestrator/AI 어시스턴트 (#2)
  a2a?: { agent_card_url: string; tasks_endpoint: string } | null;  // A2A 개방 (#2)
}

export async function getMcpAgentGuide(agentKey: string): Promise<McpGuide> {
  const { data } = await axios.get<McpGuide>(`/mcp/${agentKey}/guide`);
  return data;
}
