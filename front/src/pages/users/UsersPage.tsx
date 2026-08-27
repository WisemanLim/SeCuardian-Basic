import { useEffect, useState } from "react";
import {
  getUsers, createUser, deleteUser, patchUserStatus, resetUserPassword, User,
} from "../../api/users";
import { getAuth } from "../../store/auth";
import { useLocale } from "../../hooks/useLocale";
import ConfirmDialog from "../../components/ConfirmDialog";

// R18-5: 권한 서열 — 자신보다 낮은 권한만 제어 가능
const ROLE_RANK: Record<string, number> = { viewer: 0, user: 1, admin: 2, supervisor: 3 };

/* 액션 열 아이콘 */
const IcDots = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
    <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
  </svg>
);
const IcKey = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
    <path d="M10.5 0a5.5 5.5 0 0 0-5.4 6.55L.44 11.21A1.5 1.5 0 0 0 0 12.28V15a1 1 0 0 0 1 1h2.72a1.5 1.5 0 0 0 1.06-.44l.66-.66a.5.5 0 0 0 .15-.35V13.5h1.04a.5.5 0 0 0 .36-.15l.94-.94a.5.5 0 0 0 .15-.35V11h1.04a.5.5 0 0 0 .35-.14l.5-.5A5.5 5.5 0 1 0 10.5 0Zm1.75 5.25a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
  </svg>
);
const IcTrash = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
    <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916ZM6.5 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5Z" />
  </svg>
);

type UserConfirm = { type: "deactivate" | "reset" | "delete"; user: User };

const ROLE_COLORS: Record<string, string> = {
  supervisor: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  admin:      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  user:       "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  viewer:     "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};

export default function UsersPage() {
  const { t } = useLocale();
  const me = getAuth();
  const isSupervisor = me?.role === "supervisor";
  const isAdmin = isSupervisor || me?.role === "admin";

  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ user_id: "", username: "", password: "", role: "user", email: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tempPw, setTempPw] = useState<{ userId: string; password: string } | null>(null);
  const [userConfirm, setUserConfirm] = useState<UserConfirm | null>(null);
  const [errorMsg, setErrorMsg] = useState("");  // native alert 대체 — 커스텀 에러 배너

  // 하위권한 사용자만 상태 토글·비밀번호 초기화 허용 (본인 제외)
  function canManage(u: User): boolean {
    if (!isAdmin || u.user_id === me?.username) return false;
    return (ROLE_RANK[me?.role ?? ""] ?? 0) > (ROLE_RANK[u.role] ?? 0);
  }

  useEffect(() => {
    getUsers().then(setUsers).catch(console.error);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await createUser(form);
      const updated = await getUsers();
      setUsers(updated);
      setShowForm(false);
      setForm({ user_id: "", username: "", password: "", role: "user", email: "" });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail ?? t("users.createFailed"));
    } finally {
      setLoading(false);
    }
  }

  // 삭제 — 커스텀 ConfirmDialog 확인 후 실행
  async function applyDelete(u: User) {
    try {
      await deleteUser(u.user_id);
      setUsers((prev) => prev.filter((x) => x.user_id !== u.user_id));
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErrorMsg(detail ?? t("users.deleteFailed"));
    }
  }

  // R18-5: 활성/비활성 토글 — 상태 컬럼에서 직접, 비활성화는 커스텀 confirm 후
  async function applyStatus(u: User, next: "active" | "inactive") {
    try {
      await patchUserStatus(u.user_id, next);
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, status: next } : x)));
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErrorMsg(detail ?? t("users.actionFailed"));
    }
  }

  function handleStatusClick(u: User) {
    if (u.status === "active") {
      setUserConfirm({ type: "deactivate", user: u });  // 비활성화는 확인 필수
    } else {
      applyStatus(u, "active");                          // 활성화는 즉시
    }
  }

  // R18-5: 비밀번호 초기화 — 커스텀 confirm → 임시 비밀번호 1회 표시
  async function applyResetPassword(u: User) {
    try {
      const pw = await resetUserPassword(u.user_id);
      setTempPw({ userId: u.user_id, password: pw });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErrorMsg(detail ?? t("users.actionFailed"));
    }
  }

  async function handleUserConfirm() {
    if (!userConfirm) return;
    const { type, user } = userConfirm;
    setUserConfirm(null);
    if (type === "deactivate") await applyStatus(user, "inactive");
    else if (type === "reset") await applyResetPassword(user);
    else await applyDelete(user);
  }

  const FORM_FIELDS = [
    { key: "user_id",   label: t("users.userId"),       type: "text" },
    { key: "username",  label: t("users.username"),      type: "text" },
    { key: "password",  label: t("users.password"),      type: "password" },
    { key: "email",     label: t("users.emailOptional"), type: "text" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        {/* 타이틀은 상단 헤더(AppLayout)에 표시 — 본문에는 설명만 */}
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("users.pageDesc")}</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {showForm ? t("common.cancel") : t("users.addUser")}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("users.newUser")}</h2>
          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            {FORM_FIELDS.map(({ key, label, type }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                  required={key !== "email"}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t("users.role")}</label>
            <select
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(isSupervisor ? ["supervisor", "admin", "user", "viewer"] : ["admin", "user", "viewer"]).map(
                (r) => <option key={r} value={r}>{t(`users.roles.${r}`)}</option>
              )}
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {loading ? t("common.creating") : t("common.create")}
          </button>
        </form>
      )}

      {/* 오류 배너 — native alert 대체 */}
      {errorMsg && (
        <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2.5">
          <p className="text-xs text-red-600 dark:text-red-400">⚠️ {errorMsg}</p>
          <button
            onClick={() => setErrorMsg("")}
            className="text-red-300 hover:text-red-500 dark:hover:text-red-200 text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* 임시 비밀번호 1회 표시 배너 (R18-5) */}
      {tempPw && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <b>{tempPw.userId}</b> {t("users.tempPwNotice")}{" "}
            <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded select-all">{tempPw.password}</code>
          </p>
          <button
            onClick={() => setTempPw(null)}
            className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="text-left px-4 py-3">{t("users.userId")}</th>
              <th className="text-left px-4 py-3">{t("users.username")}</th>
              <th className="text-left px-4 py-3">{t("users.role")}</th>
              <th className="text-left px-4 py-3">{t("users.status")}</th>
              <th className="text-left px-4 py-3">{t("users.joinDate")}</th>
              {isAdmin && (
                <th className="px-4 py-3">
                  {/* 설정 컬럼 — ⋯ 아이콘 */}
                  <span className="inline-flex justify-end w-full text-gray-400 dark:text-gray-500" title={t("users.actions")}>
                    <IcDots />
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 dark:text-gray-500 py-8">{t("users.noUsers")}</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{u.user_id}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] ?? "bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>
                    {t(`users.roles.${u.role}`) ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {/* R18-5: 관리 가능 사용자는 상태 컬럼에서 직접 토글 (비활성화는 confirm) */}
                  {canManage(u) ? (
                    <button
                      type="button"
                      onClick={() => handleStatusClick(u)}
                      title={u.status === "active" ? t("common.disable") : t("common.enable")}
                      className={`text-xs px-2 py-0.5 rounded-full transition-all hover:ring-2 hover:ring-offset-1 dark:hover:ring-offset-gray-800 ${
                        u.status === "active"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:ring-green-300"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:ring-gray-300"
                      }`}
                    >
                      {u.status === "active" ? t("common.active") : t("common.inactive")}
                    </button>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      u.status === "active"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    }`}>
                      {u.status === "active" ? t("common.active") : t("common.inactive")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : "-"}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                    {/* 활성/비활성은 상태 컬럼에서 직접 토글 — 여기는 아이콘 액션만 (R18-5) */}
                    {canManage(u) && (
                      <button
                        onClick={() => setUserConfirm({ type: "reset", user: u })}
                        className="align-middle text-gray-300 dark:text-gray-600 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
                        title={t("users.resetPwd")}
                      >
                        <IcKey />
                      </button>
                    )}
                    {isSupervisor && u.user_id !== me?.username && u.role !== "supervisor" && (
                      <button
                        onClick={() => setUserConfirm({ type: "delete", user: u })}
                        className="align-middle text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        title={t("common.delete")}
                      >
                        <IcTrash />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 커스텀 confirm — 비활성화·비밀번호 초기화·삭제 (R18-5) */}
      {userConfirm && (
        <ConfirmDialog
          title={
            userConfirm.type === "deactivate" ? t("users.deactivateTitle")
            : userConfirm.type === "reset" ? t("users.resetPwd")
            : t("users.deleteTitle")
          }
          message={
            (userConfirm.type === "deactivate" ? t("users.deactivateMessage")
             : userConfirm.type === "reset" ? t("users.resetMessage")
             : t("users.deleteMessage")
            ).replace("{name}", userConfirm.user.user_id)
          }
          confirmLabel={
            userConfirm.type === "deactivate" ? t("common.disable")
            : userConfirm.type === "reset" ? t("users.resetPwd")
            : t("common.delete")
          }
          cancelLabel={t("common.cancel")}
          danger={userConfirm.type !== "reset"}
          onConfirm={handleUserConfirm}
          onCancel={() => setUserConfirm(null)}
        />
      )}
    </div>
  );
}
