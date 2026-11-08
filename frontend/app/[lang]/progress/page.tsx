"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { StageDistribution } from "@/components/bits";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { useApi, wsPath } from "@/lib/api";
import { DIRECTION_LABEL, typeLabel, typePlural } from "@/lib/format";
import type { Progress } from "@/lib/types";

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "7", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

function Acc({ value }: { value: number | null }) {
  if (value === null) return <span className="dim mono small">no data</span>;
  return (
    <span className={`acc${value < 70 ? " low" : ""}`}>
      <span className="bar">
        <i style={{ width: `${value}%` }} />
      </span>
      {value}%
    </span>
  );
}

export default function ProgressPage() {
  const { lang } = useParams<{ lang: string }>();
  const { workspace } = useApp();
  const [period, setPeriod] = useState("30");
  const progress = useApi<Progress>(wsPath(lang, `/progress?period=${period}`));
  const p = progress.data;
  const periodLabel = PERIODS.find((x) => x.value === period)?.label.toLowerCase() ?? "";

  return (
    <Page title="Progress" eyebrow={`${workspace?.name ?? ""}${workspace ? " · " : ""}${periodLabel}`}>
      {progress.error && <ErrorBox message={progress.error.message} onRetry={progress.reload} />}
      {!p && progress.loading && <Loading />}
      {p && (
        <>
          <div className="stats">
            <div>
              <b>{p.summary.accuracy === null ? "—" : `${p.summary.accuracy}%`}</b>
              <span>review accuracy</span>
            </div>
            <div>
              <b>{p.summary.answers}</b>
              <span>answers</span>
            </div>
            <div>
              <b>
                {p.summary.streak_days} {p.summary.streak_days === 1 ? "day" : "days"}
              </b>
              <span>streak</span>
            </div>
            <div>
              <b>{p.summary.mastered}</b>
              <span>mastered items</span>
            </div>
          </div>

          <section className="section">
            <div className="between">
              <h2>Accuracy by type</h2>
              <select aria-label="Period" style={{ width: "auto" }} value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="lead dim">
              Reviews and lessons count toward the first three columns. Practice is shown separately because it never
              changes your schedule.
            </p>
            {p.by_type.length === 0 ? (
              <p className="dim" style={{ margin: 0 }}>
                No items yet. Add some, then come back after a few reviews.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Items</th>
                      <th>Reviews</th>
                      <th>To meaning</th>
                      <th>To Japanese</th>
                      <th>Practice</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.by_type.map((r) => (
                      <tr key={r.type}>
                        <td>
                          <b>{typeLabel(r.type)}</b>
                        </td>
                        <td className="n">{r.items}</td>
                        <td>
                          <Acc value={r.review} />
                        </td>
                        <td>
                          <Acc value={r.to_meaning} />
                        </td>
                        <td>
                          <Acc value={r.to_japanese} />
                        </td>
                        <td>
                          <Acc value={r.practice} />
                        </td>
                        <td>
                          <Link href={`/${lang}/practice?types=${encodeURIComponent(r.type)}`}>Practice</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {p.weakest ? (
              <div className="verdict bad" style={{ width: "100%" }}>
                <b>
                  {typePlural(p.weakest.type).replace(/^./, (c) => c.toUpperCase())} are your weakest type.
                </b>{" "}
                {p.weakest.direction && p.weakest.direction_accuracy !== null
                  ? `Most misses are ${DIRECTION_LABEL[p.weakest.direction]} (${p.weakest.direction_accuracy}%). `
                  : `Review accuracy is ${p.weakest.review}%. `}
                <Link
                  href={`/${lang}/practice?types=${encodeURIComponent(p.weakest.type)}${
                    p.weakest.direction ? `&direction=${p.weakest.direction}` : ""
                  }`}
                >
                  Practice {typePlural(p.weakest.type)}
                  {p.weakest.direction ? `, ${DIRECTION_LABEL[p.weakest.direction]}` : ""}
                </Link>
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                The weakest type shows up once a type has at least 5 review answers in this period.
              </p>
            )}
          </section>

          <section className="section">
            <h2>Where your items are</h2>
            <StageDistribution dist={p.distribution} />
          </section>
        </>
      )}
    </Page>
  );
}
