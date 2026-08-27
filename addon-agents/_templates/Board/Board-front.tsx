/**
 * Board Agent — 게시판 프론트엔드 컴포넌트
 *
 * 독립형 i18n: localStorage "locale" 키 사용 (앱 공용 locale 파일 불필요)
 * 다크 모드: Tailwind dark: 클래스 (앱 테마와 자동 동기화)
 * API prefix: /api/addon/board/posts
 */
import { useEffect, useState } from "react";
import client from "../../../api/client";

// ─── i18n ────────────────────────────────────────────────────────────────────

const LOCALE: Record<string, Record<string, string>> = {
  ko: {
    title: "게시판",
    desc: "게시글을 작성·수정·삭제하고 댓글로 소통합니다.",
    newPost: "새 글 작성",
    noPosts: "게시글이 없습니다",
    back: "← 목록으로",
    editPost: "글 수정",
    comments: "댓글",
    noComments: "댓글이 없습니다",
    addComment: "등록",
    commentPlaceholder: "댓글을 입력하세요 (Enter)",
    titleLabel: "제목",
    contentLabel: "내용",
    titlePlaceholder: "제목을 입력하세요",
    contentPlaceholder: "내용을 입력하세요",
    save: "저장",
    cancel: "취소",
    edit: "수정",
    delete: "삭제",
    confirmDeletePost: "이 게시글을 삭제하시겠습니까?",
    confirmDeleteComment: "이 댓글을 삭제하시겠습니까?",
    loading: "불러오는 중...",
    prev: "이전",
    next: "다음",
    total: "총",
    count: "건",
  },
  en: {
    title: "Board",
    desc: "Create, edit, and delete posts, and discuss via comments.",
    newPost: "New Post",
    noPosts: "No posts yet",
    back: "← Back to list",
    editPost: "Edit Post",
    comments: "Comments",
    noComments: "No comments",
    addComment: "Post",
    commentPlaceholder: "Write a comment (Enter)",
    titleLabel: "Title",
    contentLabel: "Content",
    titlePlaceholder: "Enter title",
    contentPlaceholder: "Enter content",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
    confirmDeletePost: "Delete this post?",
    confirmDeleteComment: "Delete this comment?",
    loading: "Loading...",
    prev: "Prev",
    next: "Next",
    total: "Total",
    count: "posts",
  },
};

function useBoardLocale() {
  const [locale, setLocale] = useState(() => localStorage.getItem("locale") || "ko");
  useEffect(() => {
    const handler = () => setLocale(localStorage.getItem("locale") || "ko");
    window.addEventListener("localeChanged", handler);
    return () => window.removeEventListener("localeChanged", handler);
  }, []);
  return (k: string) => LOCALE[locale]?.[k] ?? LOCALE.ko[k] ?? k;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Post {
  id: number;
  title: string;
  content: string;
  author_id: string;
  author_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface Comment {
  id: number;
  content: string;
  author_id: string;
  author_name?: string;
  created_at?: string;
}

interface PostDetail extends Post {
  comments: Comment[];
}

type View = "list" | "detail" | "create" | "edit";

const BASE = "/addon/board/posts";

function parseApiError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { response?: { status?: number; data?: { detail?: unknown } } };
    const detail = e.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join(", ");
    }
    const status = e.response?.status;
    if (status === 405) return "지원하지 않는 요청 방식입니다.";
    if (status === 403) return "권한이 없습니다.";
    if (status === 404) return "항목을 찾을 수 없습니다.";
    if (status === 422) return "입력값을 확인해 주세요.";
    if (status) return `오류가 발생했습니다. (HTTP ${status})`;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

function fmtDate(s?: string) {
  if (!s) return "";
  return s.slice(0, 16).replace("T", " ");
}

// ─── PostForm ─────────────────────────────────────────────────────────────────

function PostForm({
  t,
  initial,
  onSave,
  onCancel,
  saving,
}: {
  t: (k: string) => string;
  initial?: { title: string; content: string };
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t("titleLabel")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t("contentLabel")}</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("contentPlaceholder")}
          rows={10}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !title.trim() || !content.trim()}
          onClick={() => onSave(title.trim(), content.trim())}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
        >
          {saving ? "…" : t("save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium px-5 py-2 rounded-xl transition-colors"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const t = useBoardLocale();

  const [view, setView]             = useState<View>("list");
  const [posts, setPosts]           = useState<Post[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const PAGE_SIZE                    = 20;
  const [post, setPost]             = useState<PostDetail | null>(null);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [commentInput, setComment]   = useState("");
  const [commenting, setCommenting] = useState(false);

  async function loadPosts(p: number) {
    setLoading(true);
    setError("");
    try {
      const { data } = await client.get<{ total: number; items: Post[] } | Post[]>(
        `${BASE}?page=${p}&size=${PAGE_SIZE}`
      );
      if (Array.isArray(data)) {
        setPosts(data);
        setTotal(data.length);
      } else {
        setPosts(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      setError("게시글을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPost(id: number) {
    setLoading(true);
    setError("");
    try {
      const { data } = await client.get<PostDetail>(`${BASE}/${id}`);
      setPost(data);
      setView("detail");
    } catch {
      setError("게시글을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPosts(1); }, []);

  async function handleCreate(title: string, content: string) {
    setSaving(true);
    setError("");
    try {
      await client.post(BASE, { title, content });
      setView("list");
      setPage(1);
      await loadPosts(1);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(title: string, content: string) {
    if (!post) return;
    setSaving(true);
    setError("");
    try {
      await client.patch(`${BASE}/${post.id}`, { title, content });
      await loadPost(post.id);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePost(id: number) {
    if (!confirm(t("confirmDeletePost"))) return;
    setError("");
    try {
      await client.delete(`${BASE}/${id}`);
      setPost(null);
      setView("list");
      await loadPosts(page);
    } catch (err) {
      setError(parseApiError(err));
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!post || !commentInput.trim()) return;
    setCommenting(true);
    setError("");
    try {
      await client.post(`${BASE}/${post.id}/comments`, { content: commentInput });
      setComment("");
      await loadPost(post.id);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setCommenting(false);
    }
  }

  async function handleDeleteComment(postId: number, commentId: number) {
    if (!confirm(t("confirmDeleteComment"))) return;
    setError("");
    try {
      await client.delete(`${BASE}/${postId}/comments/${commentId}`);
      await loadPost(postId);
    } catch (err) {
      setError(parseApiError(err));
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const ErrorBanner = error ? (
    <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</p>
  ) : null;

  // ── Create ──
  if (view === "create") return (
    <div className="p-6 space-y-4">
      <button onClick={() => { setError(""); setView("list"); }} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">{t("back")}</button>
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t("newPost")}</h1>
      {ErrorBanner}
      <PostForm t={t} onSave={handleCreate} onCancel={() => { setError(""); setView("list"); }} saving={saving} />
    </div>
  );

  // ── Edit ──
  if (view === "edit" && post) return (
    <div className="p-6 space-y-4">
      <button onClick={() => { setError(""); setView("detail"); }} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">{t("back")}</button>
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t("editPost")}</h1>
      {ErrorBanner}
      <PostForm t={t} initial={{ title: post.title, content: post.content }} onSave={handleEdit} onCancel={() => { setError(""); setView("detail"); }} saving={saving} />
    </div>
  );

  // ── Detail ──
  if (view === "detail" && post) return (
    <div className="p-6 space-y-5">
      <button onClick={() => { setError(""); setView("list"); setPost(null); }} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">{t("back")}</button>
      {ErrorBanner}

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex-1">{post.title}</h2>
          <div className="flex gap-3 shrink-0">
            <button onClick={() => setView("edit")} className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">{t("edit")}</button>
            <button onClick={() => handleDeletePost(post.id)} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">{t("delete")}</button>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          {post.author_name || post.author_id}
          {post.created_at && <> · {fmtDate(post.created_at)}</>}
          {post.updated_at && post.updated_at !== post.created_at && <span className="ml-1">(수정됨)</span>}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{post.content}</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm space-y-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t("comments")}{post.comments.length > 0 && ` (${post.comments.length})`}
        </p>
        {post.comments.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">{t("noComments")}</p>}
        {post.comments.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-2 py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.content}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                {c.author_name || c.author_id}{c.created_at && <> · {fmtDate(c.created_at)}</>}
              </p>
            </div>
            <button onClick={() => handleDeleteComment(post.id, c.id)}
              className="text-base text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 shrink-0 transition-colors leading-none">
              ×
            </button>
          </div>
        ))}
        <form onSubmit={handleAddComment} className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <input
            value={commentInput}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(e as unknown as React.FormEvent); } }}
            placeholder={t("commentPlaceholder")}
            disabled={commenting}
            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={commenting || !commentInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors">
            {commenting ? "…" : t("addComment")}
          </button>
        </form>
      </div>
    </div>
  );

  // ── List ──
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        {/* 타이틀은 상단 헤더(AppLayout)가 에이전트명으로 표시 — 본문에는 설명만 (가이드 규칙) */}
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("desc")}</p>
        <button onClick={() => setView("create")}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          {t("newPost")}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <p className="text-xs text-gray-400 dark:text-gray-500">{t("total")} {total}{t("count")}</p>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t("loading")}</p>}
        {!loading && posts.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t("noPosts")}</p>}
        {posts.map((p, i) => (
          <button key={p.id} type="button" onClick={() => loadPost(p.id)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${i !== 0 ? "border-t border-gray-100 dark:border-gray-700" : ""}`}>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.title}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {p.author_name || p.author_id}{p.created_at && <> · {fmtDate(p.created_at)}</>}
            </p>
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button type="button" disabled={page <= 1}
            onClick={() => { const p = page - 1; setPage(p); loadPosts(p); }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
            {t("prev")}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages}
            onClick={() => { const p = page + 1; setPage(p); loadPosts(p); }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
