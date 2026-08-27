import client from "./client";

export interface User {
  serial: number;
  user_id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export async function getUsers(): Promise<User[]> {
  const { data } = await client.get<{ users: User[]; total: number }>("/users/");
  return data.users;
}

export async function createUser(payload: {
  user_id: string;
  username: string;
  password: string;
  role: string;
  email?: string;
}): Promise<void> {
  await client.post("/users/", payload);
}

export async function deleteUser(userId: string): Promise<void> {
  await client.delete(`/users/${userId}`);
}

// R18-5: 하위권한 사용자 상태 토글·비밀번호 초기화 (supervisor/admin)
export async function patchUserStatus(userId: string, status: "active" | "inactive"): Promise<void> {
  await client.patch(`/users/${userId}/status`, { status });
}

export async function resetUserPassword(userId: string): Promise<string> {
  const { data } = await client.post<{ temp_password: string }>(`/users/${userId}/reset-password`);
  return data.temp_password;
}
