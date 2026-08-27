import client from "./client";

export interface SetupStatus {
  has_supervisor: boolean;
  completed: boolean;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const { data } = await client.get<SetupStatus>("/setup/status");
  return data;
}

export async function createSupervisor(payload: {
  user_id: string;
  username: string;
  password: string;
  email?: string;
}): Promise<void> {
  await client.post("/setup/supervisor", payload);
}

export async function saveLlmProvider(payload: {
  orchestrator_model: string;
  domain_agent_model: string;
  ollama_base_url: string;
  ollama_model: string;
  fallback_enabled: boolean;
}): Promise<void> {
  await client.put("/setup/llm-provider", payload);
}

export async function createAdmin(payload: {
  user_id: string;
  username: string;
  password: string;
  email?: string;
}): Promise<void> {
  await client.post("/setup/admin", payload);
}

export async function createUser(payload: {
  user_id: string;
  username: string;
  password: string;
  email?: string;
  role?: string;
}): Promise<void> {
  await client.post("/setup/user", payload);
}

export async function completeSetup(): Promise<void> {
  await client.post("/setup/complete");
}
