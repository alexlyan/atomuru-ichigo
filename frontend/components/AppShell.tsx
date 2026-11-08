"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errorText, wsPath } from "@/lib/api";
import type { Me, Today, WorkspaceInfo } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";

/** Something the user would lose by leaving: a running session or an unsaved item. */
export interface LeaveGuard {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Also ask before following a link to another page (not only before switching language). */
  routes: boolean;
  /** Also ask the browser to warn on reload or tab close. */
  unload?: boolean;
}

interface AppContextValue {
  lang: string;
  me: Me | null;
  workspace: WorkspaceInfo | null;
  today: Today | null;
  refresh: () => void;
  setGuard: (key: string, guard: LeaveGuard | null) => void;
  clearGuards: () => void;
  switchLanguage: (code: string) => void;
  addLanguage: (code: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}

/** Register a leave guard while `guard` is not null. */
export function useLeaveGuard(guard: LeaveGuard | null) {
  const { setGuard } = useApp();
  const id = useId();
  const key = guard ? JSON.stringify(guard) : "";
  useEffect(() => {
    setGuard(id, key ? (JSON.parse(key) as LeaveGuard) : null);
    return () => setGuard(id, null);
  }, [id, key, setGuard]);
}

const NAV: { seg: string; en: string; jp: string; count?: (t: Today) => number; gapBefore?: boolean }[] = [
  { seg: "today", en: "Home", jp: "ホーム" },
  { seg: "learn", en: "Learn", jp: "学ぶ", count: (t) => t.new_available },
  { seg: "review", en: "Review", jp: "復習", count: (t) => t.reviews_due },
  { seg: "practice", en: "Practice", jp: "練習" },
  { seg: "library", en: "Library", jp: "辞書" },
  { seg: "add", en: "Add", jp: "追加" },
  { seg: "progress", en: "Progress", jp: "進歩" },
  { seg: "settings", en: "Settings", jp: "設定", gapBefore: true },
];

export function AppShell({ lang, children }: { lang: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [tick, setTick] = useState(0);
  const guards = useRef(new Map<string, LeaveGuard>());
  const [pending, setPending] = useState<{ guard: LeaveGuard; action: () => void } | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api<Me>("/api/me")
      .then((m) => {
        if (!alive) return;
        setMe(m);
        setMeError(null);
      })
      .catch((e: unknown) => alive && setMeError(errorText(e)));
    api<Today>(wsPath(lang, "/today"))
      .then((t) => alive && setToday(t))
      .catch(() => alive && setToday(null));
    return () => {
      alive = false;
    };
  }, [lang, pathname, tick]);

  const setGuard = useCallback((key: string, guard: LeaveGuard | null) => {
    if (guard) guards.current.set(key, guard);
    else guards.current.delete(key);
  }, []);
  const clearGuards = useCallback(() => guards.current.clear(), []);

  const activeGuard = useCallback((routesOnly: boolean): LeaveGuard | null => {
    const all = [...guards.current.values()].filter((g) => !routesOnly || g.routes);
    return all.length ? all[all.length - 1] : null;
  }, []);

  const requestLeave = useCallback(
    (action: () => void, routesOnly: boolean) => {
      const guard = activeGuard(routesOnly);
      if (guard) setPending({ guard, action });
      else action();
    },
    [activeGuard],
  );

  const goToLanguage = useCallback(
    (code: string) => {
      const rest = (pathname || "").split("/").slice(2).filter(Boolean);
      // Item ids belong to one language, so a card page switches to that language's library.
      const target = rest[0] === "items" ? "library" : rest.join("/") || "today";
      router.push(`/${encodeURIComponent(code)}/${target}`);
    },
    [pathname, router],
  );

  const switchLanguage = useCallback(
    (code: string) => {
      if (code === lang) return;
      requestLeave(() => {
        setSwitchError(null);
        api("/api/me/active-language", { method: "PUT", json: { language: code } })
          .then(() => goToLanguage(code))
          .catch((e: unknown) => setSwitchError(errorText(e)));
      }, false);
    },
    [lang, requestLeave, goToLanguage],
  );

  const addLanguage = useCallback(
    async (code: string) => {
      await api("/api/workspaces", { method: "POST", json: { language: code } });
      requestLeave(() => goToLanguage(code), false);
    },
    [requestLeave, goToLanguage],
  );

  // Ask before following in-app links while a page holds unsaved work.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const guard = activeGuard(true);
      if (!guard) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ guard, action: () => router.push(url.pathname + url.search + url.hash) });
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if ([...guards.current.values()].some((g) => g.unload)) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [activeGuard, router]);

  const workspace = me?.workspaces.find((w) => w.language === lang) ?? null;
  const value = useMemo<AppContextValue>(
    () => ({ lang, me, workspace, today, refresh, setGuard, clearGuards, switchLanguage, addLanguage }),
    [lang, me, workspace, today, refresh, setGuard, clearGuards, switchLanguage, addLanguage],
  );

  const current = (pathname || "").split("/")[2] || "today";
  const activeSeg = current === "items" ? "library" : current;
  const unknownLanguage = me !== null && workspace === null;

  return (
    <AppContext.Provider value={value}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app">
        <nav className="rail" aria-label="Sections">
          <div className="mark">
            <b>苺</b>
            <span>Ichigo</span>
          </div>
          {NAV.map((n) => {
            const count = today && n.count ? n.count(today) : null;
            return (
              <Fragment key={n.seg}>
                {n.gapBefore && <span className="gap" />}
                <Link
                  href={`/${lang}/${n.seg}`}
                  className={activeSeg === n.seg ? "on" : undefined}
                  aria-current={activeSeg === n.seg ? "page" : undefined}
                >
                  <span className="en">{n.en}</span>
                  {count !== null && (
                    <span className="n" aria-label={`${count} ${n.seg === "learn" ? "new" : "due"}`}>
                      {count}
                    </span>
                  )}
                  <span className="jp" lang="ja">
                    {n.jp}
                  </span>
                </Link>
              </Fragment>
            );
          })}
        </nav>
        <div style={{ minWidth: 0 }}>
          {meError && !me ? (
            <ShellMessage title="Ichigo can't reach its server." body={meError} />
          ) : unknownLanguage ? (
            <ShellMessage
              title={`You have no "${lang}" workspace.`}
              body="Pick one of your languages, or add this one in Settings."
              href={`/${me.active_language}/today`}
              linkLabel="Open your active language"
            />
          ) : (
            children
          )}
          {switchError && (
            <div style={{ padding: "0 40px 24px" }}>
              <div className="alert" role="alert">
                Could not switch language: {switchError}
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.guard.title ?? ""}
        body={pending?.guard.body ?? ""}
        confirmLabel={pending?.guard.confirmLabel ?? "Leave"}
        cancelLabel={pending?.guard.cancelLabel ?? "Stay"}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending?.action;
          guards.current.clear();
          setPending(null);
          action?.();
        }}
      />
    </AppContext.Provider>
  );
}

function ShellMessage({ title, body, href, linkLabel }: { title: string; body: string; href?: string; linkLabel?: string }) {
  return (
    <main id="main">
      <div className="box stack" style={{ maxWidth: 560 }}>
        <h2>{title}</h2>
        <p className="dim" style={{ margin: 0 }}>
          {body}
        </p>
        {href && (
          <div className="row">
            <Link className="btn" href={href}>
              {linkLabel}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
