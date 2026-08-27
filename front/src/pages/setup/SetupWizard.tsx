import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { enableTotpWithToken, getTotpQrWithToken, login } from "../../api/auth";
import {
  completeSetup,
  createAdmin,
  createSupervisor,
  createUser,
  getSetupStatus,
  saveLlmProvider,
} from "../../api/setup";

type Step =
  | "welcome"
  | "supervisor"
  | "totp"
  | "llm"
  | "admin"
  | "user"
  | "done";

const STEPS: Step[] = [
  "welcome",
  "supervisor",
  "totp",
  "llm",
  "admin",
  "user",
  "done",
];

function StepIndicator({ current }: { current: Step }) {
  const visibleSteps: Step[] = ["welcome", "supervisor", "llm", "done"];
  const visibleLabels = ["시작", "계정 생성", "LLM 설정", "완료"];
  const idx = STEPS.indexOf(current);

  return (
    <div className="flex items-center justify-center gap-1 mb-8 flex-wrap">
      {visibleSteps.map((s, i) => {
        const done = idx > STEPS.indexOf(s);
        const active =
          s === current ||
          (current === "totp" && s === "supervisor") ||
          (current === "admin" && s === "llm") ||
          (current === "user" && s === "llm");
        return (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done
                  ? "bg-blue-600 text-white"
                  : active
                    ? "bg-blue-600 text-white ring-4 ring-blue-100"
                    : "bg-gray-200 text-gray-400"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs ${active ? "text-blue-600 font-medium" : "text-gray-400"}`}
            >
              {visibleLabels[i]}
            </span>
            {i < visibleSteps.length - 1 && (
              <div className="w-6 h-px bg-gray-200" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = true,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{" "}
        {!required && <span className="text-gray-400 font-normal">(선택)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const [sv, setSv] = useState({
    user_id: "",
    username: "",
    password: "",
    email: "",
  });
  const [llm, setLlm] = useState({
    orchestrator_model: "claude-sonnet-4-6",
    domain_agent_model: "claude-haiku-4-5-20251001",
    ollama_base_url: "http://localhost:11434",
    ollama_model: "mistral",
    fallback_enabled: true,
  });
  const [adm, setAdm] = useState({
    user_id: "",
    username: "",
    password: "",
    email: "",
  });
  const [usr, setUsr] = useState({
    user_id: "",
    username: "",
    password: "",
    email: "",
    role: "user",
  });

  // TOTP wizard state
  const [wizardToken, setWizardToken] = useState("");
  const [totpOtpauth, setTotpOtpauth] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then((status) => {
        if (status.completed) navigate("/login", { replace: true });
        else if (status.has_supervisor) setStep("llm");
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  async function submit(fn: () => Promise<void>, next: Step) {
    setError("");
    setLoading(true);
    try {
      await fn();
      setStep(next);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        .response?.data?.detail;
      setError(detail ?? "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  async function handleSupervisorDone(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await createSupervisor(sv);
      // Auto-login to get token for TOTP setup
      const loginRes = await login(sv.user_id, sv.password);
      setWizardToken(loginRes.access_token);
      // Pre-fetch QR so the TOTP step loads instantly
      const qr = await getTotpQrWithToken(loginRes.access_token);
      setTotpOtpauth(qr.otpauth);
      setStep("totp");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        .response?.data?.detail;
      setError(detail ?? "계정 생성에 실패했습니다");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnableTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await enableTotpWithToken(wizardToken, totpCode);
      setTotpEnabled(true);
      setStep("llm");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        .response?.data?.detail;
      setError(detail ?? "인증 코드가 올바르지 않습니다");
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete() {
    setLoading(true);
    try {
      await completeSetup();
    } catch {
      /* ignore */
    } finally {
      navigate("/login", { replace: true });
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-gray-100">
        <p className="text-gray-400 text-sm">초기화 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-gray-100 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-1">
            SeCuardian-Basic
          </p>
          <h1 className="text-2xl font-bold text-gray-800">Setup Wizard</h1>
        </div>

        <StepIndicator current={step} />

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {/* Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-4">
            <p className="text-gray-600 text-sm leading-relaxed">
              SeCuardian-Basic for Multi AI Agents 플랫폼을 처음 설치합니다.
              <br />
              최고 관리자 계정과 LLM Provider를 설정하면 바로 사용할 수
              있습니다.
            </p>
            <div className="grid grid-cols-4 gap-2 text-xs text-gray-500 py-2">
              {[
                ["👤", "Supervisor 생성"],
                ["🔐", "2FA 설정"],
                ["🤖", "LLM 연결"],
                ["🚀", "즉시 사용"],
              ].map(([icon, label]) => (
                <div
                  key={label}
                  className="bg-gray-50 rounded-lg p-3 text-center"
                >
                  <div className="text-xl mb-1">{icon}</div>
                  {label}
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep("supervisor")}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              시작하기
            </button>
          </div>
        )}

        {/* Supervisor */}
        {step === "supervisor" && (
          <form onSubmit={handleSupervisorDone} className="space-y-4">
            <p className="text-sm text-gray-500 mb-2">
              최고 관리자(Supervisor) 계정을 생성합니다.
            </p>
            <Field
              label="아이디"
              value={sv.user_id}
              onChange={(v) => setSv((p) => ({ ...p, user_id: v }))}
            />
            <Field
              label="이름"
              value={sv.username}
              onChange={(v) => setSv((p) => ({ ...p, username: v }))}
            />
            <Field
              label="비밀번호"
              type="password"
              value={sv.password}
              onChange={(v) => setSv((p) => ({ ...p, password: v }))}
            />
            <Field
              label="이메일"
              type="email"
              value={sv.email}
              onChange={(v) => setSv((p) => ({ ...p, email: v }))}
              required={false}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? "생성 중..." : "계정 생성"}
            </button>
          </form>
        )}

        {/* TOTP Setup (optional) */}
        {step === "totp" && (
          <div className="space-y-5">
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-gray-700">
                🔐 2단계 인증 설정
              </p>
              <p className="text-xs text-gray-500">
                Google Authenticator · Authy · Microsoft Authenticator로 계정을
                보호합니다.
                <br />이 단계는 건너뛸 수 있으며, 나중에 마이페이지에서 설정할
                수 있습니다.
              </p>
            </div>

            {totpOtpauth && (
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 bg-white border border-gray-200 rounded-xl">
                  <QRCodeSVG value={totpOtpauth} size={160} />
                </div>
                <details className="text-xs text-gray-400 w-full">
                  <summary className="cursor-pointer hover:text-gray-600 text-center">
                    수동 입력 코드 보기
                  </summary>
                  <p className="mt-1 font-mono break-all bg-gray-50 rounded p-2 text-center">
                    {totpOtpauth.match(/secret=([^&]+)/)?.[1] ?? ""}
                  </p>
                </details>
              </div>
            )}

            {totpEnabled ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-green-600 text-sm font-medium">
                  ✓ 2단계 인증이 활성화되었습니다
                </p>
                <button
                  onClick={() => setStep("llm")}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  다음 단계 →
                </button>
              </div>
            ) : (
              <form onSubmit={handleEnableTotp} className="space-y-3">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="인증 앱의 6자리 코드 입력"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-center tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? "확인 중..." : "2FA 활성화"}
                </button>
              </form>
            )}

            {!totpEnabled && (
              <button
                onClick={() => setStep("llm")}
                className="w-full border border-gray-300 text-gray-600 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                건너뛰기 (나중에 설정)
              </button>
            )}
          </div>
        )}

        {/* LLM Provider */}
        {step === "llm" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(() => saveLlmProvider(llm), "admin");
            }}
            className="space-y-4"
          >
            <p className="text-sm text-gray-500 mb-2">
              LLM Provider를 설정합니다. (기본값: Ollama 로컬)
            </p>
            {[
              { key: "orchestrator_model", label: "Orchestrator 모델" },
              { key: "domain_agent_model", label: "Domain Agent 모델" },
              { key: "ollama_base_url", label: "Ollama URL" },
              { key: "ollama_model", label: "Ollama 모델" },
            ].map(({ key, label }) => (
              <Field
                key={key}
                label={label}
                value={llm[key as keyof typeof llm] as string}
                onChange={(v) => setLlm((p) => ({ ...p, [key]: v }))}
              />
            ))}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="fallback"
                checked={llm.fallback_enabled}
                onChange={(e) =>
                  setLlm((p) => ({ ...p, fallback_enabled: e.target.checked }))
                }
                className="rounded"
              />
              <label htmlFor="fallback" className="text-sm text-gray-700">
                Ollama Fallback 활성화
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? "저장 중..." : "설정 저장"}
            </button>
          </form>
        )}

        {/* Admin (선택) */}
        {step === "admin" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              관리자(Admin) 계정을 추가합니다. 이 단계는 건너뛸 수 있습니다.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(() => createAdmin(adm), "user");
              }}
              className="space-y-3"
            >
              <Field
                label="아이디"
                value={adm.user_id}
                onChange={(v) => setAdm((p) => ({ ...p, user_id: v }))}
              />
              <Field
                label="이름"
                value={adm.username}
                onChange={(v) => setAdm((p) => ({ ...p, username: v }))}
              />
              <Field
                label="비밀번호"
                type="password"
                value={adm.password}
                onChange={(v) => setAdm((p) => ({ ...p, password: v }))}
              />
              <Field
                label="이메일"
                type="email"
                value={adm.email}
                onChange={(v) => setAdm((p) => ({ ...p, email: v }))}
                required={false}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {loading ? "생성 중..." : "관리자 생성"}
              </button>
            </form>
            <button
              onClick={() => setStep("user")}
              className="w-full border border-gray-300 text-gray-600 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              건너뛰기
            </button>
          </div>
        )}

        {/* User (선택) */}
        {step === "user" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              일반 사용자 계정을 추가합니다. 이 단계는 건너뛸 수 있습니다.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(() => createUser(usr), "done");
              }}
              className="space-y-3"
            >
              <Field
                label="아이디"
                value={usr.user_id}
                onChange={(v) => setUsr((p) => ({ ...p, user_id: v }))}
              />
              <Field
                label="이름"
                value={usr.username}
                onChange={(v) => setUsr((p) => ({ ...p, username: v }))}
              />
              <Field
                label="비밀번호"
                type="password"
                value={usr.password}
                onChange={(v) => setUsr((p) => ({ ...p, password: v }))}
              />
              <Field
                label="이메일"
                type="email"
                value={usr.email}
                onChange={(v) => setUsr((p) => ({ ...p, email: v }))}
                required={false}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  역할
                </label>
                <select
                  value={usr.role}
                  onChange={(e) =>
                    setUsr((p) => ({ ...p, role: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="user">User (전체 권한)</option>
                  <option value="viewer">Viewer (조회 전용)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {loading ? "생성 중..." : "사용자 생성"}
              </button>
            </form>
            <button
              onClick={() => setStep("done")}
              className="w-full border border-gray-300 text-gray-600 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              건너뛰기
            </button>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <p className="text-gray-700 font-medium">설치가 완료되었습니다!</p>
            <p className="text-sm text-gray-500">
              Supervisor 계정으로 로그인하면 AI Assistant 및 관리 기능을 사용할
              수 있습니다.
              {totpEnabled && " 2단계 인증이 활성화되어 있습니다."}
            </p>
            <button
              onClick={handleComplete}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? "..." : "로그인 화면으로"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
