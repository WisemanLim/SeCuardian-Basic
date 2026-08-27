import client from "./client";

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  username: string;
  totp_enabled: boolean;
}

export async function login(
  userId: string,
  password: string,
  totp?: string,
): Promise<LoginResponse> {
  const { data } = await client.post<LoginResponse>("/auth/login", {
    user_id: userId,
    password,
    ...(totp ? { totp } : {}),
  });
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout").catch(() => {});
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export interface TotpQrResponse {
  otpauth: string;
  enabled: boolean;
}

export async function getTotpQr(): Promise<TotpQrResponse> {
  const { data } = await client.get<TotpQrResponse>("/auth/totp/qr");
  return data;
}

export async function getTotpQrWithToken(token: string): Promise<TotpQrResponse> {
  const { data } = await client.get<TotpQrResponse>("/auth/totp/qr", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function enableTotp(code: string): Promise<void> {
  await client.post("/auth/totp/enable", { code });
}

export async function enableTotpWithToken(token: string, code: string): Promise<void> {
  await client.post("/auth/totp/enable", { code }, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function disableTotp(code: string): Promise<void> {
  await client.post("/auth/totp/disable", { code });
}
