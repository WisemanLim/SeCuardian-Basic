import client from "./client";

export interface McpConfig {
  agent_key: string;
  port: number | null;
  extra_args: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string | null;
}

export type McpStatusColor = "green" | "orange" | "red";

export interface McpStatus {
  status: McpStatusColor;
  message: string;
}

export async function getMcpConfig(key: string): Promise<McpConfig | null> {
  try {
    const { data } = await client.get<McpConfig>(`/mcp-configs/${key}`);
    return data;
  } catch {
    return null;
  }
}

export async function listMcpConfigs(): Promise<McpConfig[]> {
  const { data } = await client.get<{ configs: McpConfig[] }>("/mcp-configs/");
  return data.configs ?? [];
}

export async function upsertMcpConfig(
  key: string,
  body: { port?: number | null; extra_args?: string[]; is_enabled?: boolean },
): Promise<McpConfig> {
  const { data } = await client.put<McpConfig>(`/mcp-configs/${key}`, body);
  return data;
}

export async function deleteMcpConfig(key: string): Promise<void> {
  await client.delete(`/mcp-configs/${key}`);
}

export async function getMcpStatus(key: string): Promise<McpStatus> {
  const { data } = await client.get<McpStatus>(`/mcp-configs/${key}/status`);
  return data;
}
