"use client";

import { useId } from "react";
import { KIND_CLASS, parseMarked, typeLabel } from "@/lib/format";
import type { Distribution, Kind } from "@/lib/types";

/** Seven cells filled up to the current stage. Not started and stage 0 show all cells empty. */
export function StageMeter({ stage }: { stage: number | null }) {
  const s = stage ?? 0;
  const label = stage === null ? "New" : `Stage ${stage}`;
  return (
    <span className="meter" title={stage === null ? "Not started" : `Stage ${stage} of 7`}>
      <span className="cells" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <i key={i} className={i <= s ? "f" : undefined} />
        ))}
      </span>
      <span className="lbl">{label}</span>
    </span>
  );
}

export function KindTag({ kind }: { kind: Kind }) {
  return <span className={`tag ${KIND_CLASS[kind]}`}>{kind}</span>;
}

/** Big text in the practice square, shrunk for long words. */
export function SquareText({ text }: { text: string }) {
  const len = [...text].length;
  const size = len <= 3 ? undefined : len <= 5 ? "md" : "sm";
  return (
    <b className={size} lang="ja">
      {text}
    </b>
  );
}

/** A grammar example with its [marked] part highlighted. */
export function MarkedSentence({ ja }: { ja: string }) {
  const m = parseMarked(ja);
  if (!m) return <>{ja.replace(/[[\]]/g, "")}</>;
  return (
    <>
      {m.before}
      <span className="hl">{m.target}</span>
      {m.after}
    </>
  );
}

const STAGES: { key: string[]; label: string; color: string }[] = [
  { key: ["not_started", "0"], label: "New (stage 0)", color: "var(--st-0)" },
  { key: ["1"], label: "Stage 1", color: "var(--st-1)" },
  { key: ["2"], label: "Stage 2", color: "var(--st-2)" },
  { key: ["3"], label: "Stage 3", color: "var(--st-3)" },
  { key: ["4"], label: "Stage 4", color: "var(--st-4)" },
  { key: ["5"], label: "Stage 5", color: "var(--st-5)" },
  { key: ["6"], label: "Stage 6", color: "var(--st-6)" },
  { key: ["7"], label: "Stage 7, mastered", color: "var(--st-7)" },
];

/** One bar with segments sized by count, plus a legend. */
export function StageDistribution({ dist }: { dist: Distribution }) {
  const rows = STAGES.map((s) => ({ ...s, n: s.key.reduce((sum, k) => sum + (dist[k] ?? 0), 0) }));
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return (
    <>
      <div
        className="dist"
        role="img"
        aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(", ")}
      >
        {rows.map((r) =>
          r.n > 0 ? (
            <i
              key={r.label}
              style={{ width: `${((100 * r.n) / total).toFixed(1)}%`, background: r.color }}
              title={`${r.label}: ${r.n}`}
            />
          ) : null,
        )}
      </div>
      <div className="dist-legend">
        {rows.map((r) => (
          <div key={r.label}>
            <i style={{ background: r.color }} />
            <span>
              {r.label} <span className="mono dim">{r.n}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** "All" plus every type. All is exclusive; picking a type turns All off; an empty pick falls back to All. */
export function TypeChips({
  types,
  value,
  onChange,
  label = "Types",
}: {
  types: string[];
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const id = useId();
  const all = value.length === 0;
  const toggle = (t: string) => {
    const next = value.includes(t) ? value.filter((x) => x !== t) : [...value, t];
    // Picking every type is the same as All.
    onChange(next.length === types.length ? [] : next);
  };
  return (
    <div>
      <label id={id}>{label}</label>
      <div className="chips" role="group" aria-labelledby={id}>
        <button type="button" className="chip" aria-pressed={all} onClick={() => onChange([])}>
          All
        </button>
        {types.map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={value.includes(t)} onClick={() => toggle(t)}>
            {typeLabel(t)}
          </button>
        ))}
      </div>
    </div>
  );
}
