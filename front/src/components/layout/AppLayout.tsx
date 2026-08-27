import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { logout } from "../../api/auth";
import { listAddonAgents } from "../../api/addonAgents";
import { getAuth } from "../../store/auth";
import { getTheme, setTheme, type Theme } from "../../store/theme";
import { getLocale, pickDescription, setLocale as persistLocale, type Locale } from "../../store/locale";
import { useLocale } from "../../hooks/useLocale";
import geniansCi from "../../assets/genians-ci.png";

interface ActiveAgent {
  key: string;
  name: string;
  type: "builtin" | "addon";
  names?: Record<string, string>;
}

/* ── SVG icons ─────────────────────────────────────── */
const IcAI = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M10 2a1 1 0 01.894.553l2.382 4.764 5.26.764a1 1 0 01.555 1.705l-3.806 3.71.898 5.238a1 1 0 01-1.451 1.054L10 17.347l-4.732 2.441a1 1 0 01-1.451-1.054l.898-5.238L.91 9.786a1 1 0 01.555-1.705l5.26-.764L9.106 2.553A1 1 0 0110 2z" />
  </svg>
);
const IcAgents = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M10 2a4 4 0 100 8 4 4 0 000-8zM5.004 11.503A7 7 0 003 17.5c0 .276.224.5.5.5h13a.5.5 0 00.5-.5 7 7 0 00-2.004-5.997A5.99 5.99 0 0110 13a5.99 5.99 0 01-4.996-1.497z" clipRule="evenodd" />
  </svg>
);
const IcUsers = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M7 8a3 3 0 100-6 3 3 0 000 6zm7.5 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 0111.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 017 17a9.953 9.953 0 01-5.385-1.572zm13.66 2.234a.75.75 0 00.039-1.497A5.022 5.022 0 0013 15c-.836 0-1.622.199-2.313.554a7.493 7.493 0 013.629 3.108z" />
  </svg>
);
const IcSettings = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);
const IcPanel = () => (
  <svg viewBox="0 0 18 18" fill="currentColor" className="w-[18px] h-[18px]">
    <path d="M2 3a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 16 3v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 15V3zm1.5-.25a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25H6.5V2.75H3.5zm4.25 0V15.25H14.5a.25.25 0 0 0 .25-.25V3a.25.25 0 0 0-.25-.25H7.75z" />
  </svg>
);
const IcBot = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M10 2a1 1 0 011 1v1h3a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h3V3a1 1 0 011-1zM7 8a1 1 0 100 2 1 1 0 000-2zm6 0a1 1 0 100 2 1 1 0 000-2zm-3 4a3 3 0 01-2.83-2h5.66A3 3 0 0110 12z" />
  </svg>
);
const IcExternal = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3h5v5M17 3l-7 7M8 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3" />
  </svg>
);

const THEMES: { value: Theme; labelKey: string; icon: string }[] = [
  { value: "light",  labelKey: "theme.light",  icon: "☀️" },
  { value: "dark",   labelKey: "theme.dark",   icon: "🌙" },
  { value: "system", labelKey: "theme.system", icon: "💻" },
];

const LOCALES: { value: Locale; native: string }[] = [
  { value: "ko", native: "한국어" },
  { value: "en", native: "English" },
];

/* ── Sidebar nav & text classes per theme ────────────── */
const sidebar = {
  bg:      "bg-gray-100  dark:bg-[#1a1a1a]",
  border:  "border-gray-200 dark:border-white/10",
  logo:    "text-gray-800  dark:text-white",
  sub:     "text-gray-500  dark:text-gray-500",
  nav: {
    base:        "text-gray-500  dark:text-gray-400 hover:bg-gray-200  dark:hover:bg-white/5  hover:text-gray-900 dark:hover:text-gray-200",
    active:      "bg-gray-200   dark:bg-white/10    text-gray-900      dark:text-white",
    agent:       "text-blue-500 dark:text-blue-400  hover:bg-blue-50   dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300",
    agentActive: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
  },
  menu: {
    bg:      "bg-white       dark:bg-[#2a2a2a]",
    item:    "text-gray-600  dark:text-gray-300  hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white",
    divider: "border-gray-200 dark:border-white/10",
    danger:  "text-gray-500  dark:text-gray-400  hover:bg-gray-100 dark:hover:bg-white/5 hover:text-red-500 dark:hover:text-red-400",
  },
  user: {
    btn:  "hover:bg-gray-200 dark:hover:bg-white/5",
    name: "text-gray-700  dark:text-gray-200",
    role: "text-gray-400  dark:text-gray-500",
  },
};

/* ── NavLink class helper ────────────────────────────── */
function navCls(isActive: boolean, agent = false, collapsed = false) {
  return [
    "flex items-center gap-2.5 px-2 py-2 rounded-md text-[13px] transition-colors",
    collapsed ? "justify-center" : "",
    agent
      ? isActive ? sidebar.nav.agentActive : sidebar.nav.agent
      : isActive ? sidebar.nav.active      : sidebar.nav.base,
  ].join(" ");
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getAuth();
  const isAdmin = user?.role === "supervisor" || user?.role === "admin";
  // 별도 창(팝아웃) 모드 — ?popout=1 진입 시 사이드바 없이 화면만 렌더
  const isPopout = new URLSearchParams(location.search).get("popout") === "1";

  const [collapsed,    setCollapsed]    = useState(false);
  const [theme,        setThemeState]   = useState<Theme>(getTheme());
  const [showMenu,     setShowMenu]     = useState(false);
  const [showThemeSub, setShowThemeSub] = useState(false);
  const [showLangSub,  setShowLangSub]  = useState(false);
  const [locale,       setLocaleState]  = useState<Locale>(getLocale());
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const { t } = useLocale();

  function refreshAgents() {
    listAddonAgents().catch(() => []).then((addons) => {
      const addon: ActiveAgent[] = addons
        .filter((a) => a.is_active && a.has_front)
        .map((a) => ({ key: a.agent_key, name: pickDescription(a.agent_names, a.agent_name, null) || a.agent_name, names: a.agent_names ?? undefined, type: "addon" }));
      setActiveAgents(addon);
    });
  }

  useEffect(() => {
    refreshAgents();
    window.addEventListener("agentConfigChanged", refreshAgents);
    return () => window.removeEventListener("agentConfigChanged", refreshAgents);
  }, []);

  const initials = (user?.username ?? "U")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  // 헤더 타이틀 — 현재 메뉴(라우트)별 타이틀 표시, ADDON 은 에이전트명
  const path = location.pathname;
  let headerTitle = "SeCuardian-Basic Platform";
  if (path.startsWith("/chat")) headerTitle = "AI Assistant";
  else if (path.startsWith("/agents")) headerTitle = t("agent.management");
  else if (path.startsWith("/users")) headerTitle = t("users.title");
  else if (path.startsWith("/settings")) headerTitle = t("settings.title");
  else if (path.startsWith("/profile")) headerTitle = t("profile.title");
  else if (path.startsWith("/addon/")) {
    const key = path.split("/")[2];
    headerTitle = (() => { const ag = activeAgents.find((a) => a.key === key); return ag ? (pickDescription(ag.names, ag.name, null) || ag.name) : "SeCuardian-Basic Platform"; })();
  }

  const themeLabel  = t(`theme.${theme}`);
  const localeLabel = LOCALES.find((l) => l.value === locale)?.native ?? "한국어";

  function applyTheme(th: Theme) {
    setTheme(th);
    setThemeState(th);
    setShowThemeSub(false);
    setShowLangSub(false);
    setShowMenu(false);
  }

  function applyLocale(loc: Locale) {
    persistLocale(loc);
    setLocaleState(loc);
    setShowLangSub(false);
    setShowMenu(false);
  }

  async function handleLogout() {
    setShowMenu(false);
    await logout();
    navigate("/login", { replace: true });
  }

  // 현재 화면을 별도 창으로 열기 — popout 파라미터를 붙여 사이드바 없는 포커스 뷰로 기동
  function openInWindow() {
    const params = new URLSearchParams(location.search);
    params.set("popout", "1");
    const url = `${location.pathname}?${params.toString()}`;
    const name = `secuardian_${location.pathname.replace(/\W+/g, "_")}`;
    window.open(url, name, "width=1200,height=820,menubar=no,toolbar=no,location=no");
  }

  // 팝아웃 모드: 사이드바/유저메뉴 없이 헤더 + 본문만 렌더
  if (isPopout) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
        <header className="h-12 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 shrink-0">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{headerTitle}</span>
          <div id="page-header-actions" className="flex items-center gap-2 shrink-0" />
        </header>
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className={`relative flex flex-col shrink-0 transition-all duration-200 border-r ${sidebar.bg} ${sidebar.border} ${collapsed ? "w-[52px]" : "w-[200px]"}`}>

        {/* Logo row */}
        <div className="flex items-center justify-between px-3 pt-4 pb-3">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center shrink-0 border border-gray-100 dark:border-transparent">
                  <img src={geniansCi} alt="Genians CI" className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-bold leading-tight truncate ${sidebar.logo}`}>SeCuardian-Basic</p>
                  <p className={`text-[10px] leading-tight ${sidebar.sub}`}>Platform</p>
                </div>
              </div>
              <button
                onClick={() => setCollapsed(true)}
                className={`p-1 rounded transition-colors shrink-0 ${sidebar.sub} hover:${sidebar.logo}`}
                title="접기"
              >
                <IcPanel />
              </button>
            </>
          ) : (
            <button
              onClick={() => setCollapsed(false)}
              className={`mx-auto p-1 rounded transition-colors ${sidebar.sub}`}
              title="펼치기"
            >
              <IcPanel />
            </button>
          )}
        </div>

        {/* ── Nav ─────────────────────────────────────────── */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">

          {/* AI Assistant */}
          <NavLink
            to="/chat"
            title={collapsed ? t("nav.aiAssistant") : undefined}
            className={({ isActive }) => navCls(isActive, false, collapsed)}
          >
            <span className="shrink-0"><IcAI /></span>
            {!collapsed && <span>{t("nav.aiAssistant")}</span>}
          </NavLink>

          {/* 에이전트 관리 (supervisor/admin) */}
          {isAdmin && (
            <NavLink
              to="/agents"
              title={collapsed ? t("nav.agents") : undefined}
              className={({ isActive }) => navCls(isActive, false, collapsed)}
            >
              <span className="shrink-0"><IcAgents /></span>
              {!collapsed && <span>{t("nav.agents")}</span>}
            </NavLink>
          )}

          {/* Active addon agents — between 에이전트 and 사용자 */}
          {activeAgents.length > 0 && (
            <>
              <div className={`my-1.5 mx-1 border-t ${sidebar.border}`} />
              {activeAgents.map((agent) => (
                <NavLink
                  key={agent.key}
                  to={`/addon/${agent.key}`}
                  title={collapsed ? (pickDescription(agent.names, agent.name, null) || agent.name) : undefined}
                  className={({ isActive }) => navCls(isActive, true, collapsed)}
                >
                  <span className="shrink-0"><IcBot /></span>
                  {!collapsed && <span className="truncate">{pickDescription(agent.names, agent.name, null) || agent.name}</span>}
                </NavLink>
              ))}
              <div className={`my-1.5 mx-1 border-t ${sidebar.border}`} />
            </>
          )}

        </nav>

        {/* 사용자 관리 (supervisor/admin) — 로그인 사용자 블록 바로 위 하단 배치 */}
        {isAdmin && (
          <nav className="px-2 pb-1">
            <NavLink
              to="/users"
              title={collapsed ? t("nav.users") : undefined}
              className={({ isActive }) => navCls(isActive, false, collapsed)}
            >
              <span className="shrink-0"><IcUsers /></span>
              {!collapsed && <span>{t("nav.users")}</span>}
            </NavLink>
          </nav>
        )}

        {/* ── User block ───────────────────────────────── */}
        <div className={`relative border-t ${sidebar.border} px-2 py-3`}>
          <button
            onClick={() => { setShowMenu((v) => !v); setShowThemeSub(false); setShowLangSub(false); }}
            className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors ${collapsed ? "justify-center" : ""} ${sidebar.user.btn}`}
          >
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 text-left">
                <p className={`text-[13px] font-medium truncate ${sidebar.user.name}`}>{user?.username}</p>
                <p className={`text-[11px] truncate ${sidebar.user.role}`}>{user?.role}</p>
              </div>
            )}
          </button>

          {/* ── Popup menu ─────────────────────────────── */}
          {showMenu && (
            <div className={`absolute bottom-full mb-1 left-2 right-2 rounded-xl border shadow-xl overflow-visible z-50 ${sidebar.menu.bg} ${sidebar.menu.divider} border`}>

              {/* Profile header */}
              <div className={`px-3 py-3 border-b ${sidebar.menu.divider}`}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">{initials}</div>
                  <div className="min-w-0">
                    <p className={`text-[13px] font-medium truncate ${sidebar.user.name}`}>{user?.username}</p>
                    <p className={`text-[11px] truncate ${sidebar.user.role}`}>{user?.role}</p>
                  </div>
                </div>
              </div>

              {/* 마이페이지 */}
              <button
                onClick={() => { setShowMenu(false); navigate("/profile"); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors ${sidebar.menu.item}`}
              >
                <span>👤</span>{t("menu.myPage")}
              </button>

              {/* 외형 (theme) */}
              <div className="relative">
                <button
                  onClick={() => { setShowThemeSub((v) => !v); setShowLangSub(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors ${sidebar.menu.item}`}
                >
                  <span className="flex items-center gap-2"><span>🎨</span>{t("menu.appearance")}</span>
                  <span className={`text-[11px] flex items-center gap-1 ${sidebar.user.role}`}>
                    {themeLabel} <span>›</span>
                  </span>
                </button>

                {showThemeSub && (
                  <div className={`absolute left-full top-0 ml-1 w-36 rounded-xl border shadow-xl overflow-hidden z-60 ${sidebar.menu.bg} ${sidebar.menu.divider} border`}>
                    {THEMES.map((th) => (
                      <button
                        key={th.value}
                        onClick={() => applyTheme(th.value)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-[13px] transition-colors ${sidebar.menu.item}`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{th.icon}</span>{t(th.labelKey)}
                        </span>
                        {theme === th.value && <span className="text-blue-500 text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 언어 */}
              <div className="relative">
                <button
                  onClick={() => { setShowLangSub((v) => !v); setShowThemeSub(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors ${sidebar.menu.item}`}
                >
                  <span className="flex items-center gap-2"><span>🌐</span>{t("menu.language")}</span>
                  <span className={`text-[11px] flex items-center gap-1 ${sidebar.user.role}`}>
                    {localeLabel} <span>›</span>
                  </span>
                </button>

                {showLangSub && (
                  <div className={`absolute left-full top-0 ml-1 w-36 rounded-xl border shadow-xl overflow-hidden z-60 ${sidebar.menu.bg} ${sidebar.menu.divider} border`}>
                    {LOCALES.map((loc) => (
                      <button
                        key={loc.value}
                        onClick={() => applyLocale(loc.value)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-[13px] transition-colors ${sidebar.menu.item}`}
                      >
                        <span>{loc.native}</span>
                        {locale === loc.value && <span className="text-blue-500 text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 설정 */}
              <button
                onClick={() => { setShowMenu(false); navigate("/settings"); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors ${sidebar.menu.item}`}
              >
                <IcSettings /><span>{t("menu.settings")}</span>
              </button>

              {/* 로그아웃 */}
              <div className={`border-t ${sidebar.menu.divider}`}>
                <button
                  onClick={handleLogout}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors ${sidebar.menu.danger}`}
                >
                  <span>🚪</span>{t("menu.logout")}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-12 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">
              {headerTitle}
            </span>
            {/* 현재 화면을 별도 창으로 열기 */}
            <button
              onClick={openInWindow}
              title={t("nav.openWindow")}
              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors shrink-0"
            >
              <IcExternal />
            </button>
          </div>
          {/* 페이지별 우측 액션 슬롯 — ChatPage 모델 선택 등이 portal 로 렌더 */}
          <div id="page-header-actions" className="flex items-center gap-2 shrink-0" />
        </header>
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950">{children}</main>
      </div>

      {/* Backdrop */}
      {showMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowMenu(false); setShowThemeSub(false); setShowLangSub(false); }}
        />
      )}
    </div>
  );
}
