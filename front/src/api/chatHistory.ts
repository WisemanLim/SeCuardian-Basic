import client from "./client";

// R18-2 사용자별 대화이력 + R18-3 만족도 피드백 + R18-4 관리자 건의

export interface ServerSession {
  session_key: string;
  agent_key: string | null;
  title: string | null;
  model: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ServerMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
  rating: "bad" | "fine" | "good" | null;
}

export type FeedbackRating = "bad" | "fine" | "good";

export async function listChatSessions(): Promise<ServerSession[]> {
  const { data } = await client.get<{ sessions: ServerSession[] }>("/chat/sessions");
  return data.sessions ?? [];
}

export async function getChatMessages(sessionKey: string): Promise<ServerMessage[]> {
  const { data } = await client.get<{ messages: ServerMessage[] }>(
    `/chat/sessions/${sessionKey}/messages`,
  );
  return data.messages ?? [];
}

export interface ExchangeBody {
  title?: string;
  model?: string;
  agent_key?: string;
  user_content: string;
  assistant_content: string;
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  assistant_model?: string;
}

export async function saveExchange(
  sessionKey: string,
  body: ExchangeBody,
): Promise<{ user_message_id: number; assistant_message_id: number }> {
  const { data } = await client.post(`/chat/sessions/${sessionKey}/exchange`, body);
  return data;
}

export async function deleteChatSession(sessionKey: string): Promise<void> {
  await client.delete(`/chat/sessions/${sessionKey}`);
}

export async function sendFeedback(messageId: number, rating: FeedbackRating): Promise<void> {
  await client.put(`/chat/messages/${messageId}/feedback`, { rating });
}

export async function createSuggestion(title: string, content: string): Promise<{ id: number }> {
  const { data } = await client.post("/suggestions", { title, content });
  return data;
}
