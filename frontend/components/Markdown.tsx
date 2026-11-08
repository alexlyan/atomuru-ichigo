"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown with GFM tables. Raw HTML is not rendered, so content cannot inject markup. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
