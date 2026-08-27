import { useState } from "react";
import { useNavigate } from "react-router";
import { login } from "../api/auth";
import client from "../api/client";
import { setAuth } from "../store/auth";
import { setLocale, setPreferredLang, type Locale } from "../store/locale";
import { useLocale } from "../hooks/useLocale";

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(userId, password, needTotp ? totp : undefined);
      setAuth({
        token: data.access_token,
        role: data.role,
        username: data.username,
        totpEnabled: data.totp_enabled,
      });
      // R18-7: 선호언어 동기화 — 서버 preferred_lang 을 UI locale 초기값으로 반영
      try {
        const { data: me } = await client.get<{ preferred_lang?: string | null }>("/auth/me");
        if (me.preferred_lang) {
          setPreferredLang(me.preferred_lang);
          if (me.preferred_lang === "ko" || me.preferred_lang === "en") {
            setLocale(me.preferred_lang as Locale);
          }
        }
      } catch { /* best-effort */ }
      navigate("/chat", { replace: true });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      if (detail === "totp_required") {
        setNeedTotp(true);
        setError(t("auth.totpRequired"));
      } else {
        setError(detail ?? t("auth.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-1">{t("auth.login")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">SeCuardian-Basic</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("auth.userId")}</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoFocus={!needTotp}
              disabled={needTotp}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("auth.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={needTotp}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          {needTotp && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                <span>🔐</span> {t("profile.totp")}
              </div>
              <input
                type="text"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
                maxLength={6}
                inputMode="numeric"
                placeholder="000000"
                className="w-full border border-blue-300 dark:border-blue-700 rounded-lg px-3 py-2 text-sm text-center tracking-[0.4em] font-mono bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {t("auth.totpDesc")}
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {loading ? t("auth.loggingIn") : needTotp ? t("auth.verifyCode") : t("auth.login")}
          </button>

          {needTotp && (
            <button
              type="button"
              onClick={() => { setNeedTotp(false); setTotp(""); setError(""); }}
              className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {t("auth.backToLogin")}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
