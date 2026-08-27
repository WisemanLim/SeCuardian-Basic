import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import client from "../../api/client";
import { getAuth, setAuth } from "../../store/auth";
import { getTotpQr, enableTotp, disableTotp } from "../../api/auth";
import { setPreferredLang } from "../../store/locale";
import { useLocale } from "../../hooks/useLocale";

interface Profile {
  user_id: string;
  username: string;
  email: string;
  role: string;
  totp_enabled: boolean;
  custom_instructions: string | null;
  preferred_lang: string | null;
  created_at: string;
}

// R18-7: 선호언어 선택지 — 타 언어 지원 시 여기에 추가
const PREFERRED_LANGS: { value: string; labelKey: string }[] = [
  { value: "ko", labelKey: "locale.ko" },
  { value: "en", labelKey: "locale.en" },
  { value: "jp", labelKey: "locale.jp" },
];

export default function ProfilePage() {
  const { t } = useLocale();
  const authUser = getAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({ username: "", email: "" });
  const [pwForm, setPwForm] = useState({ next: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [userInstr, setUserInstr] = useState("");
  const [userInstrSaved, setUserInstrSaved] = useState(false);
  const [userInstrSaving, setUserInstrSaving] = useState(false);
  const [prefLang, setPrefLang] = useState("ko");
  const [prefLangSaved, setPrefLangSaved] = useState(false);
  const [prefLangSaving, setPrefLangSaving] = useState(false);

  const [totpOtpauth, setTotpOtpauth] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpError, setTotpError] = useState("");
  const [totpSuccess, setTotpSuccess] = useState("");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    client
      .get<Profile>("/auth/me")
      .then(({ data }) => {
        setProfile(data);
        setForm({ username: data.username ?? "", email: data.email ?? "" });
        setTotpEnabled(data.totp_enabled);
        setUserInstr(data.custom_instructions ?? "");
        setPrefLang(data.preferred_lang ?? "ko");
      })
      .catch(() => setError(t("profile.updateFailed")))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      await client.patch("/auth/me", { username: form.username, email: form.email });
      setSuccess(t("common.saved"));
      if (authUser) setAuth({ ...authUser, username: form.username });
      setProfile((p) => p ? { ...p, username: form.username, email: form.email } : p);
    } catch {
      setError(t("profile.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");
    if (pwForm.next !== pwForm.confirm) { setPwError(t("profile.passwordMismatch")); return; }
    if (pwForm.next.length < 8) { setPwError(t("profile.passwordTooShort")); return; }
    setPwSaving(true);
    try {
      await client.patch("/auth/me", { password: pwForm.next });
      setPwSuccess(t("profile.passwordChanged"));
      setPwForm({ next: "", confirm: "" });
    } catch {
      setPwError(t("profile.passwordFailed"));
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSaveUserInstr() {
    setUserInstrSaving(true);
    try {
      await client.patch("/auth/me", { custom_instructions: userInstr });
      setUserInstrSaved(true);
      setTimeout(() => setUserInstrSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setUserInstrSaving(false);
    }
  }

  async function handleSavePrefLang() {
    setPrefLangSaving(true);
    try {
      await client.patch("/auth/me", { preferred_lang: prefLang });
      setPreferredLang(prefLang); // 로컬 fallback 체인에 즉시 반영
      setPrefLangSaved(true);
      setTimeout(() => setPrefLangSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setPrefLangSaving(false);
    }
  }

  async function handleShowQr() {
    setTotpError("");
    setTotpSuccess("");
    setTotpLoading(true);
    try {
      const res = await getTotpQr();
      setTotpOtpauth(res.otpauth);
      setTotpEnabled(res.enabled);
      setShowQr(true);
    } catch {
      setTotpError("QR 코드를 불러올 수 없습니다");
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleEnableTotp(e: React.FormEvent) {
    e.preventDefault();
    setTotpError("");
    setTotpLoading(true);
    try {
      await enableTotp(totpCode);
      setTotpEnabled(true);
      setTotpSuccess("2단계 인증이 활성화되었습니다 🎉");
      setTotpCode("");
      setShowQr(false);
      setProfile((p) => p ? { ...p, totp_enabled: true } : p);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setTotpError(detail ?? "활성화에 실패했습니다");
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleDisableTotp(e: React.FormEvent) {
    e.preventDefault();
    setTotpError("");
    setTotpLoading(true);
    try {
      await disableTotp(totpCode);
      setTotpEnabled(false);
      setTotpSuccess("2단계 인증이 비활성화되었습니다");
      setTotpCode("");
      setTotpOtpauth("");
      setShowQr(false);
      setProfile((p) => p ? { ...p, totp_enabled: false } : p);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setTotpError(detail ?? "비활성화에 실패했습니다");
    } finally {
      setTotpLoading(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-gray-400 dark:text-gray-500 text-sm">{t("common.loading")}</div>;
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* 타이틀은 상단 헤더(AppLayout)에 표시 — 본문에는 설명만 */}
      <p className="text-sm text-gray-500 dark:text-gray-400">{t("profile.pageDesc")}</p>

      {/* Account info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-2xl">👤</div>
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-200">{profile?.username}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">
                {t(`users.roles.${profile?.role ?? "user"}`) ?? profile?.role}
              </span>
              {totpEnabled && (
                <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full flex items-center gap-1">
                  🔐 2FA {t("profile.totpActive")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-400 dark:text-gray-500 text-xs mb-0.5">{t("users.userId")}</p>
            <p className="text-gray-700 dark:text-gray-300 font-mono">{profile?.user_id}</p>
          </div>
          <div>
            <p className="text-gray-400 dark:text-gray-500 text-xs mb-0.5">{t("users.joinDate")}</p>
            <p className="text-gray-700 dark:text-gray-300">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "-"}
            </p>
          </div>
        </div>
      </div>

      {/* Profile edit */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">{t("profile.title")}</h2>
        {success && <p className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 mb-3">{success}</p>}
        {error && <p className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-3">{error}</p>}
        <form onSubmit={handleSave} className="space-y-3">
          {[
            { key: "username", label: t("profile.username"), type: "text" },
            { key: "email",    label: t("profile.email"),    type: "email" },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
              <input
                type={type}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors">
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </div>

      {/* Password change */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">{t("profile.password")}</h2>
        {pwSuccess && <p className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 mb-3">{pwSuccess}</p>}
        {pwError && <p className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-3">{pwError}</p>}
        <form onSubmit={handlePasswordChange} className="space-y-3">
          {[
            { key: "next",    label: t("profile.newPassword")     },
            { key: "confirm", label: t("profile.confirmPassword") },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
              <input
                type="password"
                value={pwForm[key as keyof typeof pwForm]}
                onChange={(e) => setPwForm((p) => ({ ...p, [key]: e.target.value }))}
                required
                minLength={8}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <p className="text-xs text-gray-400 dark:text-gray-500">{t("profile.passwordTooShort")}</p>
          <button type="submit" disabled={pwSaving} className="bg-gray-800 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors">
            {pwSaving ? t("common.saving") : t("profile.password")}
          </button>
        </form>
      </div>

      {/* 2FA / TOTP */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              🔐 {t("profile.totp")}
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Google Authenticator, Authy 등 인증 앱으로 계정을 보호합니다
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${totpEnabled ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
            {totpEnabled ? t("profile.totpActive") : t("profile.totpInactive")}
          </span>
        </div>

        {totpSuccess && <p className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 mb-3">{totpSuccess}</p>}
        {totpError && <p className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-3">{totpError}</p>}

        {!totpEnabled && !showQr && (
          <button
            onClick={handleShowQr}
            disabled={totpLoading}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {totpLoading ? t("profile.totpLoading") : t("profile.totpEnable")}
          </button>
        )}

        {!totpEnabled && showQr && totpOtpauth && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              인증 앱으로 아래 QR 코드를 스캔하세요.
            </p>
            <div className="flex justify-center p-4 bg-white rounded-xl border border-gray-200 dark:border-gray-700 w-fit mx-auto">
              <QRCodeSVG value={totpOtpauth} size={180} />
            </div>
            <details className="text-xs text-gray-400 dark:text-gray-600">
              <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">수동 입력 코드 보기</summary>
              <p className="mt-1 font-mono break-all bg-gray-50 dark:bg-gray-700 rounded p-2 text-gray-700 dark:text-gray-300">
                {totpOtpauth.match(/secret=([^&]+)/)?.[1] ?? ""}
              </p>
            </details>
            <form onSubmit={handleEnableTotp} className="flex gap-2">
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                inputMode="numeric"
                placeholder={t("profile.totpCodePlaceholder")}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-center tracking-widest font-mono bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={totpLoading || totpCode.length !== 6}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {totpLoading ? t("profile.totpLoading") : t("profile.totpVerify")}
              </button>
            </form>
            <button
              onClick={() => { setShowQr(false); setTotpCode(""); setTotpError(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        {totpEnabled && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              2단계 인증이 활성화되어 있습니다. 비활성화하려면 인증 코드를 입력하세요.
            </p>
            <form onSubmit={handleDisableTotp} className="flex gap-2">
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                inputMode="numeric"
                placeholder={t("profile.totpCodePlaceholder")}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-center tracking-widest font-mono bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={totpLoading || totpCode.length !== 6}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {totpLoading ? t("profile.totpProcessing") : t("profile.totpDisable")}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Preferred language (R18-7) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">🌐 {t("profile.preferredLang")}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("profile.preferredLangDesc")}</p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={prefLang}
            onChange={(e) => setPrefLang(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PREFERRED_LANGS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </select>
          <button
            onClick={handleSavePrefLang}
            disabled={prefLangSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {prefLangSaved ? t("common.saved") : prefLangSaving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>

      {/* Custom instructions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("profile.customInstructions")}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("profile.customInstructionsDesc")}</p>
        </div>
        <textarea
          value={userInstr}
          onChange={(e) => setUserInstr(e.target.value)}
          rows={5}
          placeholder={t("profile.customInstructionsPlaceholder")}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <button
          onClick={handleSaveUserInstr}
          disabled={userInstrSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {userInstrSaved ? t("common.saved") : userInstrSaving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
