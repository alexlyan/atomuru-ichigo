import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function activeLanguage(): Promise<string | null> {
  const base = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/me`, { cache: "no-store" });
    if (!res.ok) return null;
    const me = (await res.json()) as { active_language?: string };
    return me.active_language || null;
  } catch {
    return null;
  }
}

/** "/" opens the active language's Today screen. */
export default async function Root() {
  const lang = await activeLanguage();
  if (lang) redirect(`/${encodeURIComponent(lang)}/today`);
  return (
    <main style={{ margin: "0 auto", maxWidth: 560, padding: "64px 16px" }}>
      <div className="box stack">
        <h2>Ichigo can&apos;t reach its server.</h2>
        <p className="dim" style={{ margin: 0 }}>
          The API did not answer at <span className="mono">{process.env.API_URL || "http://localhost:8000"}</span>. Start
          the backend, then reload this page.
        </p>
        <div className="row">
          <Link className="btn" href="/" prefetch={false}>
            Try again
          </Link>
        </div>
      </div>
    </main>
  );
}
