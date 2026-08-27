export interface ChatMeta {
  elapsedMs: number;                                  // 질의→응답 소요시간
  usage?: { input_tokens?: number; output_tokens?: number };  // 토큰 사용량
  model?: string;                                     // 사용 모델
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  meta?: ChatMeta;                                    // 응답 품질 지표 (AI 응답만)
}

// R18-2: 세션 영속화는 서버 DB(tbl_chat_sessions/tbl_chat_messages)로 이전 — api/chatHistory.ts 사용.
// 아래 헬퍼는 세션 키 생성·제목 생성 용도로 유지.

export function newSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function makeTitle(firstUserMessage: string): string {
  return firstUserMessage.trim().slice(0, 40) || "새 대화";
}
