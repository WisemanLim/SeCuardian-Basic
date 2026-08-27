import client from "./client";

export interface Setting {
  key: string;
  value: string;
  description: string;
  updated_at: string | null;
}

export async function getSettings(): Promise<Setting[]> {
  const { data } = await client.get<{ settings: Setting[] }>("/settings/");
  return data.settings;
}

export async function updateSetting(key: string, value: string, description = ""): Promise<void> {
  await client.put(`/settings/${key}`, { value, description });
}

export async function testLlm(): Promise<{ ollama: boolean; anthropic_configured: boolean }> {
  const { data } = await client.post("/settings/test-llm");
  return data;
}

export async function getUiConfig(): Promise<{ agent_create_mode: string; marketplace_enabled?: boolean }> {
  const { data } = await client.get("/settings/ui-config");
  return data;
}
