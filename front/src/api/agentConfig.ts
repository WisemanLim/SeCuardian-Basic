import client from "./client";
import type { WorkerInfo } from "./addonAgents";

export interface AgentConfig {
  agent_key: string;
  agent_name: string;
  is_enabled: boolean;
  is_required: boolean;
  model: string | null;
  system_prompt: string | null;
  description: string | null;
  description_en: string | null;
  descriptions?: Record<string, string> | null;
  agent_names?: Record<string, string> | null;
  disabled_reason: string | null;
  disabled_reason_en: string | null;
  nav_group: string | null;
  sort_order: number;
  has_worker?: boolean;          // R22-5: worker 필요 — 카드 설치 가이드 아이콘 상시 노출
}

export async function listAgentConfigs(): Promise<AgentConfig[]> {
  const { data } = await client.get<{ agents: AgentConfig[] }>("/agent-config/");
  return data.agents ?? [];
}

export async function patchAgentConfig(
  key: string,
  payload: { is_enabled?: boolean; model?: string | null; system_prompt?: string | null }
): Promise<AgentConfig & { worker?: WorkerInfo }> {
  const { data } = await client.patch<AgentConfig & { worker?: WorkerInfo }>(
    `/agent-config/${key}`, payload
  );
  return data;
}
