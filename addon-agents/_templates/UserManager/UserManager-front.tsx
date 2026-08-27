/**
 * UserManager Agent — tbl_addon_user 사용자 관리 컴포넌트
 *
 * 독립형 i18n: localStorage "locale" 키 사용
 * 다크 모드: Tailwind dark: 클래스
 * API prefix: /addon/usermanager/users
 */
import { useEffect, useState } from "react";
import client from "../../../api/client";

// ─── i18n ────────────────────────────────────────────────────────────────────

const LOCALE: Record<string, Record<string, string>> = {
  ko: {
    title: "사용자 관리",
    desc: "에이전트 사용자를 추가·수정·삭제하고 역할·상태·비밀번호를 관리합니다.",
    addUser: "사용자 추가",
    noUsers: "사용자 없음",
    loading: "불러오는 중...",
    search: "검색 (이름·아이디·이메일)",
    all: "전체",
    active: "활성",
    inactive: "비활성",
    suspended: "정지",
    username: "아이디",
    fullName: "이름",
    email: "이메일",
    role: "역할",
    status: "상태",
    password: "비밀번호",
    passwordDefault: "기본값: changeme123",
    notes: "메모",
    save: "저장",
    cancel: "취소",
    edit: "수정",
    delete: "삭제",
    resetPwd: "비밀번호 초기화",
    confirmDelete: "이 사용자를 삭제하시겠습니까?",
    confirmReset: "비밀번호를 초기화하시겠습니까? 초기값: changeme123",
    resetOk: "비밀번호가 초기화되었습니다",
    prev: "이전",
    next: "다음",
    usernamePlaceholder: "영문·숫자 (필수)",
    total: "총",
    count: "명",
  },
  en: {
    title: "User Manager",
    desc: "Add, edit, and delete agent users — manage roles, status, and passwords.",
    addUser: "Add User",
    noUsers: "No users",
    loading: "Loading...",
    search: "Search (name · username · email)",
    all: "All",
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
    username: "Username",
    fullName: "Full Name",
    email: "Email",
    role: "Role",
    status: "Status",
    password: "Password",
    passwordDefault: "Default: changeme123",
    notes: "Notes",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
    resetPwd: "Reset Password",
    confirmDelete: "Delete this user?",
    confirmReset: "Reset password to changeme123?",
    resetOk: "Password has been reset",
    prev: "Prev",
    next: "Next",
    usernamePlaceholder: "Alphanumeric (required)",
    total: "Total",
    count: "users",
  },
};

const ROLE_LABELS: Record<string, Record<string, string>> = {
  ko: { admin: "관리자", manager: "매니저", user: "사용자", viewer: "뷰어" },
  en: { admin: "Admin", manager: "Manager", user: "User", viewer: "Viewer" },
};

const STATUS_LABELS: Record<string, Record<string, string>> = {
  ko: { active: "활성", inactive: "비활성", suspended: "정지" },
  en: { active: "Active", inactive: "Inactive", suspended: "Suspended" },
};

function getLoc() { return localStorage.getItem("locale") || "ko"; }
function roleLabel(role: string) { return ROLE_LABELS[getLoc()]?.[role] ?? role; }
function statusLabel(status: string) { return STATUS_LABELS[getLoc()]?.[status] ?? status; }

function useLocale() {
  const [locale, setLocale] = useState(() => localStorage.getItem("locale") || "ko");
  useEffect(() => {
    const h = () => setLocale(localStorage.getItem("locale") || "ko");
    window.addEventListener("localeChanged", h);
    return () => window.removeEventListener("localeChanged", h);
  }, []);
  const L = LOCALE[locale] ?? LOCALE.ko;
  return (k: string) => (L as Record<string, string>)[k] ?? (LOCALE.ko as Record<string, string>)[k] ?? k;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface User {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  role: string;
  status: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

const BASE = "/addon/usermanager/users";
const ROLES = ["admin", "manager", "user", "viewer"] as const;
const STATUSES = ["active", "inactive", "suspended"] as const;

function fmtDate(s?: string) {
  return s ? s.slice(0, 10) : "";
}

// ─── UserForm ─────────────────────────────────────────────────────────────────

function UserForm({
  t,
  initial,
  onSave,
  onCancel,
  saving,
  isEdit,
}: {
  t: (k: string) => string;
  initial?: Partial<User & { password?: string }>;
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  const [form, setForm] = useState({
    username: initial?.username ?? "",
    full_name: initial?.full_name ?? "",
    email: initial?.email ?? "",
    role: initial?.role ?? "user",
    status: initial?.status ?? "active",
    password: "",
    notes: initial?.notes ?? "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSubmit() {
    const data: Record<string, string> = {
      full_name: form.full_name,
      email: form.email,
      role: form.role,
      status: form.status,
      notes: form.notes,
    };
    if (!isEdit) {
      data.username = form.username.trim();
      if (form.password) data.password = form.password;
    }
    onSave(data);
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {!isEdit && (
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("username")} *</label>
          <input value={form.username} onChange={(e) => set("username", e.target.value)}
            placeholder={t("usernamePlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("fullName")}</label>
        <input value={form.full_name} onChange={(e) => set("full_name", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("email")}</label>
        <input value={form.email} onChange={(e) => set("email", e.target.value)} type="email"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("role")}</label>
        <select value={form.role} onChange={(e) => set("role", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("status")}</label>
        <select value={form.status} onChange={(e) => set("status", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>
      {!isEdit && (
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("password")}</label>
          <input value={form.password} onChange={(e) => set("password", e.target.value)} type="password"
            placeholder={t("passwordDefault")}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      )}
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("notes")}</label>
        <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>
      <div className="col-span-2 flex gap-2">
        <button type="button" disabled={saving || (!isEdit && !form.username.trim())} onClick={handleSubmit}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
          {saving ? "…" : t("save")}
        </button>
        <button type="button" onClick={onCancel}
          className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium px-5 py-2 rounded-lg transition-colors">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active:    "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    inactive:  "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
    suspended: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls[status] ?? cls.inactive}`}>
      {statusLabel(status)}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function UserManagerPage() {
  const t = useLocale();

  const [users, setUsers]       = useState<User[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const PAGE_SIZE               = 20;
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState("");
  const [filterStatus, setFilter] = useState("");
  const [showAdd, setShowAdd]   = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [saving, setSaving]     = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  async function load(p = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), size: String(PAGE_SIZE) });
      if (search) params.set("q", search);
      if (filterStatus) params.set("status", filterStatus);
      const { data } = await client.get<{ total: number; items: User[] }>(`${BASE}?${params}`);
      setUsers(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []);

  async function handleCreate(data: Record<string, string>) {
    setSaving(true);
    try {
      await client.post(BASE, data);
      setShowAdd(false);
      await load(1);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(data: Record<string, string>) {
    if (!editUser) return;
    setSaving(true);
    try {
      await client.patch(`${BASE}/${editUser.id}`, data);
      setEditUser(null);
      await load(page);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await client.delete(`${BASE}/${u.id}`);
      await load(page);
    } catch { /* ignore */ }
  }

  async function handleReset(u: User) {
    if (!confirm(t("confirmReset"))) return;
    try {
      await client.post(`${BASE}/${u.id}/reset-password`);
      setResetMsg(`${u.username}: ${t("resetOk")}`);
      setTimeout(() => setResetMsg(""), 3000);
    } catch { /* ignore */ }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-4xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        {/* 타이틀은 상단 헤더(AppLayout)가 에이전트명으로 표시 — 본문에는 설명만 (가이드 규칙) */}
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("desc")}</p>
        <button onClick={() => { setShowAdd(true); setEditUser(null); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {t("addUser")}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-200 dark:border-blue-800 p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t("addUser")}</p>
          <UserForm t={t} isEdit={false} onSave={handleCreate} onCancel={() => setShowAdd(false)} saving={saving} />
        </div>
      )}

      {resetMsg && <p className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">{resetMsg}</p>}

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(1)}
          placeholder={t("search")}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {(["", ...STATUSES] as string[]).map((s) => (
          <button key={s} type="button" onClick={() => { setFilter(s); load(1); }}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${filterStatus === s ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
            {s ? t(s) : t("all")}
          </button>
        ))}
        <button type="button" onClick={() => load(1)}
          className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          🔍
        </button>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">{t("total")} {total}{t("count")}</p>

      {/* User list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 shadow-sm overflow-hidden">
        {loading && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t("loading")}</p>}
        {!loading && users.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t("noUsers")}</p>}

        {users.map((u) => (
          <div key={u.id}>
            {editUser?.id === u.id ? (
              <div className="p-4">
                <UserForm t={t} isEdit initial={u} onSave={handleUpdate} onCancel={() => setEditUser(null)} saving={saving} />
              </div>
            ) : (
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{u.username}</span>
                    {u.full_name && <span className="text-xs text-gray-500 dark:text-gray-400">{u.full_name}</span>}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{roleLabel(u.role)}</span>
                    <StatusBadge status={u.status} />
                  </div>
                  {u.email && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{u.email}</p>}
                  {u.notes && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-xs">{u.notes}</p>}
                  <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">{fmtDate(u.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleReset(u)}
                    className="text-xs text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                    {t("resetPwd")}
                  </button>
                  <button onClick={() => { setEditUser(u); setShowAdd(false); }}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    {t("edit")}
                  </button>
                  <button onClick={() => handleDelete(u)}
                    className="text-xs text-red-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                    {t("delete")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => load(page - 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
            {t("prev")}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => load(page + 1)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
