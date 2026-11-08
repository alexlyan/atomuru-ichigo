import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ margin: "0 auto", maxWidth: 560, padding: "64px 16px" }}>
      <div className="box stack">
        <h2>This page does not exist.</h2>
        <p className="dim" style={{ margin: 0 }}>
          The link may be old, or the item was deleted.
        </p>
        <div className="row">
          <Link className="btn" href="/">
            Go to today
          </Link>
        </div>
      </div>
    </main>
  );
}
