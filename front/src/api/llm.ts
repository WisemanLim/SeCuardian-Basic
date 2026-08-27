import client from "./client";

// R19: LLM provider·모델·사용량 API

export interface LlmModelOption {
  value: string;
  label: string;
  provider: string;
}

export async function listLlmModels(): Promise<{ models: LlmModelOption[]; default: string }> {
  const { data } = await client.get("/llm/models");
  return data;
}

export interface LlmUsageRow {
  grp: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency_ms: number;
}

export async function getLlmUsage(
  groupBy = "model",
  days = 30
): Promise<{ group_by: string; days: number; rows: LlmUsageRow[] }> {
  const { data } = await client.get("/llm/usage", { params: { group_by: groupBy, days } });
  return data;
}
