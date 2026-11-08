"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { useApp, useLeaveGuard } from "@/components/AppShell";
import { TypeChips } from "@/components/bits";
import { ErrorBox, Page } from "@/components/Page";
import { Session, type SessionStats } from "@/components/Session";
import { api, errorText, useApi, wsPath } from "@/lib/api";
import { STAGE_KEYS, typePlural } from "@/lib/format";
import type { Question, Settings } from "@/lib/types";

const SOURCES = [
  { value: "all", label: "All matching items" },
  { value: "most_missed", label: "Most often missed" },
  { value: "recent", label: "Learned in the last 7 days" },
  { value: "missed_7d", label: "Missed in the last 7 days" },
];
const DIRECTIONS = [
  { value: "both", label: "Both" },
  { value: "to_meaning", label: "Japanese to meaning" },
  { value: "to_japanese", label: "Meaning to Japanese" },
];
const COUNTS = [
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "500", label: "All matching" },
];

export default function PracticePage() {
  return (
    <Suspense fallback={null}>
      <Practice />
    </Suspense>
  );
}

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function stagesText(stages: string[]): string {
  if (!stages.length) return "that you have started";
  const parts: string[] = [];
  if (stages.includes("new")) parts.push("not started yet");
  const nums = stages.filter((s) => s !== "new").map(Number).sort((a, b) => a - b);
  if (nums.length === 1) parts.push(`in stage ${nums[0]}`);
  else if (nums.length > 1) {
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    parts.push(contiguous ? `in stages ${nums[0]} to ${nums[nums.length - 1]}` : `in stages ${listJoin(nums.map(String))}`);
  }
  return parts.join(" or ");
}

function Practice() {
  const { lang } = useParams<{ lang: string }>();
  const search = useSearchParams();
  const app = useApp();
  const [types, setTypes] = useState<string[]>(() => (search.get("types") ?? "").split(",").filter(Boolean));
  const [stages, setStages] = useState<string[]>(() =>
    (search.get("stages") ?? "").split(",").filter((s) => (STAGE_KEYS as readonly string[]).includes(s)),
  );
  const [source, setSource] = useState(() => {
    const s = search.get("source") ?? "all";
    return SOURCES.some((x) => x.value === s) ? s : "all";
  });
  const [direction, setDirection] = useState(() => {
    const d = search.get("direction") ?? "both";
    return DIRECTIONS.some((x) => x.value === d) ? d : "both";
  });
  const [count, setCount] = useState("20");

  const filter = new URLSearchParams();
  if (types.length) filter.set("types", types.join(","));
  if (stages.length) filter.set("stages", stages.join(","));
  filter.set("source", source);
  const filterQuery = filter.toString();

  const matching = useApi<{ count: number }>(wsPath(lang, `/practice/count?${filterQuery}`));
  const settings = useApi<Settings>(wsPath(lang, "/settings"));
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState<SessionStats | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLeaveGuard(
    questions && !finished
      ? {
          title: "End this practice session?",
          body: "Practice never changes stages or review dates, so nothing is lost.",
          confirmLabel: "End session",
          cancelLabel: "Keep practising",
          routes: false,
        }
      : null,
  );

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const qs = await api<Question[]>(
        wsPath(lang, `/practice/queue?${filterQuery}&direction=${direction}&count=${count}`),
      );
      if (!qs.length) {
        setError("Nothing matches these filters. Pick more types or stages, then start again.");
        return;
      }
      setQuestions(qs);
      setFinished(null);
      setRound((r) => r + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const onFinish = useCallback((stats: SessionStats) => setFinished(stats), []);
  const toggleStage = (s: string) => setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const n = matching.data?.count;
  const typesText = types.length ? listJoin(types.map(typePlural)) : "items of every type";

  if (questions && settings.data && !finished) {
    return (
      <Page title="Practice" eyebrow="Practice · does not change your schedule">
        <Session
          key={round}
          lang={lang}
          sessionType="practice"
          questions={questions}
          settings={settings.data}
          onFinish={onFinish}
          onEnd={() => {
            app.clearGuards();
            setQuestions(null);
          }}
        />
      </Page>
    );
  }

  return (
    <Page title="Practice" eyebrow="Extra session · does not change your schedule">
      {finished ? (
        <div className="trial">
          <h2 style={{ fontSize: 28 }}>Practice done.</h2>
          <p className="lead dim" style={{ textAlign: "center" }}>
            {finished.answered ? `${finished.correct} of ${finished.answered} correct.` : "No answers this time."} Stages
            and review dates did not change.
          </p>
          <div className="row center">
            <button type="button" className="btn lg" onClick={() => void start()} disabled={starting} autoFocus>
              Practice again
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                setFinished(null);
                setQuestions(null);
              }}
            >
              Change filters
            </button>
            <Link className="btn quiet" href={`/${lang}/today`}>
              Back to today
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="lead">
            Pick what to drill. Answers here are logged for you to see, but stages and review dates stay as they are.
          </p>
          <div className="box stack">
            {app.me && <TypeChips types={app.me.types} value={types} onChange={setTypes} />}
            <div>
              <label id="stage-label">Stage</label>
              <div className="chips" role="group" aria-labelledby="stage-label">
                {STAGE_KEYS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={stages.includes(s)}
                    onClick={() => toggleStage(s)}
                  >
                    {s === "new" ? "New" : s}
                  </button>
                ))}
              </div>
              <div className="hint">No stage picked means every item you have started.</div>
            </div>
            <div className="fieldset">
              <div>
                <label htmlFor="src">Take from</label>
                <select id="src" value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dir">Direction</label>
                <select id="dir" value={direction} onChange={(e) => setDirection(e.target.value)}>
                  {DIRECTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cnt">Questions</label>
                <select id="cnt" value={count} onChange={(e) => setCount(e.target.value)}>
                  {COUNTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {matching.error && <ErrorBox message={matching.error.message} onRetry={matching.reload} />}
            {error && <ErrorBox message={error} />}
            <div className="between">
              <span aria-live="polite">
                <b className="mono">{n ?? "…"}</b>{" "}
                <span className="dim">
                  {n === 1 ? "item matches" : "items match"}: {typesText} {stagesText(stages)}
                </span>
              </span>
              <button
                type="button"
                className="btn lg"
                onClick={() => void start()}
                disabled={starting || !settings.data || n === 0}
              >
                {starting ? "Starting…" : "Start practice"}
              </button>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
