"use client";

import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/api";
import { useApp } from "./AppShell";

/** Top-right language menu. The badge is the number of reviews due across all languages. */
export function LanguageSwitcher() {
  const { me, workspace, switchLanguage, addLanguage } = useApp();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me) {
    return <div className="switch" aria-hidden="true" style={{ minHeight: 40 }} />;
  }

  return (
    <details
      ref={ref}
      className="switch"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (!isOpen) setAdding(false);
      }}
    >
      <summary aria-label={`Language: ${workspace?.name ?? ""}. ${me.total_due} reviews due in all languages.`}>
        <span className="cur" lang={workspace?.language}>
          {workspace?.native_name ?? "Language"}
        </span>
        <span className="dim small">{workspace?.name}</span>
        <span className="due" title="Reviews due across all languages">
          {me.total_due}
        </span>
      </summary>
      <div className="menu">
        {me.workspaces.map((w) => (
          <button
            key={w.language}
            type="button"
            className={w.language === workspace?.language ? "sel" : undefined}
            aria-current={w.language === workspace?.language ? "true" : undefined}
            onClick={() => {
              setOpen(false);
              switchLanguage(w.language);
            }}
          >
            <span>
              <span className="jp-text" lang={w.language}>
                {w.native_name}
              </span>{" "}
              {w.name}
            </span>
            <span className="n">{w.due} due</span>
          </button>
        ))}
        <hr />
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} aria-expanded={false}>
            Add language
          </button>
        ) : (
          <>
            <div className="sub">Add language</div>
            {me.available_languages.length === 0 && (
              <button type="button" className="muted" disabled>
                <span>You have every language Ichigo offers.</span>
              </button>
            )}
            {me.available_languages.map((l) => (
              <button
                key={l.language}
                type="button"
                className={l.supported ? undefined : "muted"}
                disabled={!l.supported}
                onClick={() => {
                  setError(null);
                  addLanguage(l.language)
                    .then(() => setOpen(false))
                    .catch((e: unknown) => setError(errorText(e)));
                }}
              >
                <span>
                  <span lang={l.language}>{l.native_name}</span> {l.name}
                </span>
                <span>{l.supported ? "Add" : "coming soon"}</span>
              </button>
            ))}
            {error && (
              <p className="small bad-text" role="alert" style={{ margin: "4px 10px" }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
