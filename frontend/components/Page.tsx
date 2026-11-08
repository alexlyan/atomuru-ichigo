"use client";

import { useEffect } from "react";
import { LanguageSwitcher } from "./LanguageSwitcher";

/** Top bar (eyebrow + title + language switcher) and the reading column. */
export function Page({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Ichigo`;
  }, [title]);

  return (
    <>
      <div className="top">
        <h1>
          <small>{eyebrow || " "}</small>
          {title}
        </h1>
        <LanguageSwitcher />
      </div>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <p className="dim" role="status" style={{ margin: 0 }}>
      {what}…
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      {message}{" "}
      {onRetry && (
        <button type="button" className="linkish" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
