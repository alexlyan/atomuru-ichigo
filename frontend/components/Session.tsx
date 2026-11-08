"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorText, wsPath } from "@/lib/api";
import { KIND_CLASS, KIND_LABEL, inTime, parseMarked } from "@/lib/format";
import type { AcceptOut, AnswerOut, ItemOut, Question, RegradeOut, SessionType, Settings } from "@/lib/types";
import { KindTag, SquareText, StageMeter } from "./bits";
import { Loading } from "./Page";

export interface SessionStats {
  answered: number;
  correct: number;
  skipped: number;
  /** Questions in the session when it started. */
  total: number;
  /** Questions answered correctly the first time they were shown. */
  firstTry: number;
}

export interface SessionProps {
  lang: string;
  sessionType: SessionType;
  /**
   * Practice only. "line": a progress bar, and questions you miss come back until you clear them all.
   * "test": one pass with a running score such as 3/10 right.
   */
  format?: "line" | "test";
  /** Practice only: "typing" asks for typed answers; "cards" shows the answer on request and you say yes or no. */
  mode?: "typing" | "cards";
  questions: Question[];
  settings: Settings;
  /** Called when the queue runs out; return more questions to keep going (lesson rounds). */
  fetchMore?: () => Promise<Question[]>;
  onAnswer?: (q: Question, out: AnswerOut) => void;
  onAccept?: (q: Question, out: AcceptOut) => void;
  /** Left label of the session bar. Default "n / total". */
  label?: (info: { done: number; total: number; current: Question | null }) => string;
  /** Track fill, 0..1. Default done / total. */
  progress?: number;
  onProgress?: (done: number, total: number) => void;
  onFinish: (stats: SessionStats) => void;
  onEnd: () => void;
  /** Item details already known (lesson items); others are fetched when shown. */
  items?: Record<string, ItemOut>;
}

type Phase = "ask" | "sending" | "answered" | "loading";

const BLANK = "＿＿＿";

/** One runner for learn, review and practice: prompt, answer, verdict, next. */
export function Session(props: SessionProps) {
  const { lang, sessionType, settings, fetchMore, onAnswer, onAccept, onFinish, onProgress } = props;
  const mode = props.mode ?? "typing";
  const format = props.format;
  const [cleared, setCleared] = useState(0);
  const seen = useRef(new Set<string>());
  const [queue, setQueue] = useState<Question[]>(props.questions);
  const [total, setTotal] = useState(props.questions.length);
  const [done, setDone] = useState(0);
  const [seq, setSeq] = useState(0);
  const [phase, setPhase] = useState<Phase>("ask");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<AnswerOut | null>(null);
  const [accepted, setAccepted] = useState<AcceptOut | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [shown, setShown] = useState(false); // cards: the answer has been revealed
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ItemOut>>(props.items ?? {});
  const stats = useRef<SessionStats>({
    answered: 0,
    correct: 0,
    skipped: 0,
    total: props.questions.length,
    firstTry: 0,
  });
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    onProgress?.(done, total);
  }, [done, total, onProgress]);

  // Item details give the facts after an answer and the exact highlight of grammar sentences.
  useEffect(() => {
    if (!current || details[current.item_id]) return;
    let alive = true;
    api<ItemOut>(wsPath(lang, `/items/${current.item_id}`))
      .then((d) => alive && setDetails((m) => ({ ...m, [d.id]: d })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [current, details, lang]);

  useEffect(() => {
    if (phase === "ask") {
      shownAt.current = Date.now();
      inputRef.current?.focus();
    }
    if (phase === "answered") nextRef.current?.focus();
  }, [phase, seq]);

  const freshQuestion = useCallback(() => {
    setAnswer("");
    setResult(null);
    setAccepted(null);
    setShown(false);
    setError(null);
    setStuck(false);
    setPhase("ask");
    setSeq((s) => s + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (!fetchMore) {
      onFinish(stats.current);
      return;
    }
    setPhase("loading");
    setMoreError(null);
    try {
      const more = await fetchMore();
      if (more.length === 0) {
        onFinish(stats.current);
        return;
      }
      setQueue(more);
      setTotal((t) => t + more.length);
      freshQuestion();
    } catch (e) {
      setMoreError(errorText(e));
    }
  }, [fetchMore, onFinish, freshQuestion]);

  const advance = useCallback(() => {
    let rest = queue.slice(1);
    if (format === "line" && result) {
      // Finish line: a question is cleared once it is answered right; otherwise it comes back at the end.
      if (accepted || result.correct) setCleared((c) => c + 1);
      else rest = [...rest, queue[0]];
    }
    if (rest.length > 0) {
      setQueue(rest);
      freshQuestion();
      return;
    }
    setQueue([]);
    void loadMore();
  }, [queue, format, result, accepted, freshQuestion, loadMore]);

  const send = useCallback(
    async (extra: Record<string, unknown>, typed = "") => {
      if (!current || phase !== "ask") return;
      setPhase("sending");
      setError(null);
      try {
        const out = await api<AnswerOut>(wsPath(lang, "/answers"), {
          method: "POST",
          json: {
            item_id: current.item_id,
            session_type: sessionType,
            direction: current.direction,
            question_kind: current.question_kind,
            answer: typed,
            response_ms: Date.now() - shownAt.current,
            example_index: current.example_index,
            ...extra,
          },
        });
        stats.current.answered += 1;
        if (out.correct) stats.current.correct += 1;
        const key = `${current.item_id}:${current.direction}:${current.example_index ?? ""}`;
        if (!seen.current.has(key)) {
          seen.current.add(key);
          if (out.correct) stats.current.firstTry += 1;
        }
        setResult(out);
        setDone((d) => d + 1);
        setPhase("answered");
        onAnswer?.(current, out);
      } catch (e) {
        setPhase("ask");
        setError(errorText(e));
        setStuck(e instanceof ApiError && (e.status === 409 || e.status === 404 || e.status === 422));
      }
    },
    [current, phase, lang, sessionType, onAnswer],
  );

  const check = useCallback(async () => {
    if (!current || phase !== "ask") return;
    const text = answer.trim();
    if (!text) {
      setError(settings.skip_enabled ? "Type an answer first, or skip this question." : "Type an answer first.");
      inputRef.current?.focus();
      return;
    }
    await send({}, text);
  }, [current, phase, answer, settings.skip_enabled, send]);

  const skip = useCallback(async () => {
    if (!current || phase !== "ask" || !settings.skip_enabled) return;
    setPhase("sending");
    try {
      await api<AnswerOut>(wsPath(lang, "/answers"), {
        method: "POST",
        json: {
          item_id: current.item_id,
          session_type: sessionType,
          direction: current.direction,
          question_kind: current.question_kind,
          answer: "",
          skipped: true,
          example_index: current.example_index,
        },
      });
    } catch (e) {
      setPhase("ask");
      setError(errorText(e));
      return;
    }
    stats.current.skipped += 1;
    setQueue((q) => [...q.slice(1), q[0]]);
    freshQuestion();
  }, [current, phase, settings.skip_enabled, lang, sessionType, freshQuestion]);

  const dropCurrent = useCallback(() => {
    // The server refused this question (for example the item finished its lessons elsewhere).
    setTotal((t) => Math.max(t - 1, done));
    advance();
  }, [advance, done]);

  // "Bummer, I got it wrong" (or back to "Nailed it"): the user changes their mind after seeing the answer.
  const regrade = useCallback(
    async (correct: boolean) => {
      if (!result || !current) return;
      setRegrading(true);
      setError(null);
      try {
        const out = await api<RegradeOut>(wsPath(lang, `/answers/${result.event_id}/regrade`), {
          method: "POST",
          json: { correct },
        });
        if (result.correct !== out.correct) stats.current.correct += out.correct ? 1 : -1;
        const merged: AnswerOut = { ...result, ...out, note: "regraded" };
        setResult(merged);
        onAnswer?.(current, merged);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setRegrading(false);
      }
    },
    [result, current, lang, onAnswer],
  );

  const accept = useCallback(async () => {
    if (!result || !current) return;
    setAccepting(true);
    setError(null);
    try {
      const out = await api<AcceptOut>(wsPath(lang, `/answers/${result.event_id}/accept`), { method: "POST" });
      stats.current.correct += 1;
      setAccepted(out);
      onAccept?.(current, out);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAccepting(false);
    }
  }, [result, current, lang, onAccept]);

  // Pace after an answer, from Settings.
  const autoAdvance =
    phase === "answered" &&
    result !== null &&
    accepted === null &&
    !accepting &&
    !regrading &&
    result.note !== "self" &&
    result.note !== "regraded" &&
    (settings.after_answer === "always_advance" || (settings.after_answer === "advance_if_correct" && result.correct));
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);
  useEffect(() => {
    if (!autoAdvance) return;
    const t = window.setTimeout(() => advanceRef.current(), settings.auto_advance_seconds * 1000);
    return () => window.clearTimeout(t);
  }, [autoAdvance, settings.auto_advance_seconds, seq]);

  // Enter moves on after an answer; S skips while the answer box is not focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest?.("input, textarea, select, [contenteditable]");
      const onControl = !!el?.closest?.("button, a, summary");
      if (e.key === "Enter" && phase === "answered" && !typing && !onControl) {
        e.preventDefault();
        advance();
      } else if ((e.key === "s" || e.key === "S") && phase === "ask" && !typing && settings.skip_enabled) {
        e.preventDefault();
        void skip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance, skip, settings.skip_enabled]);

  let fill = props.progress ?? (total ? done / total : 0);
  let label = props.label ? props.label({ done, total, current }) : `${done} / ${total}`;
  if (format === "line") {
    fill = total ? cleared / total : 0;
    label = `${cleared} / ${total} cleared`;
  } else if (format === "test") {
    label = `${stats.current.correct}/${total} right`;
  }
  const detail = current ? details[current.item_id] : undefined;
  // Grammar answers are open-ended, so grammar is always graded by the user; practice can use cards for everything.
  const cardStyle = !!current && (current.kind === "grammar" || (sessionType === "practice" && mode === "cards"));

  return (
    <>
      <div className="session">
        <span className="mono small dim">{label}</span>
        <div
          className="track"
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fill * 100)}
        >
          <i style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} />
        </div>
        <button type="button" className="btn quiet" onClick={props.onEnd}>
          End session
        </button>
      </div>

      {phase === "loading" || !current ? (
        <div className="trial">
          {moreError ? (
            <>
              <div className="alert" role="alert">
                Could not load the next questions: {moreError}
              </div>
              <button type="button" className="btn" onClick={() => void loadMore()}>
                Try again
              </button>
            </>
          ) : (
            <Loading what="Getting the next questions" />
          )}
        </div>
      ) : (
        <div className="trial">
          <div className={`band ${current.direction === "to_meaning" ? "to-meaning" : "to-japanese"}`}>
            {bandText(current)}
          </div>
          <PromptView q={current} detail={detail} />
          {current.question_kind === "cloze" && current.prompt.hint && (
            <p className="dim hint-line">{current.prompt.hint}</p>
          )}

          {phase !== "answered" && cardStyle && (
            <>
              <div className="row center">
                {current.kind === "vocabulary" ? <span className="tag">{current.type}</span> : <KindTag kind={current.kind} />}
                {current.question_kind === "cloze" && detail && <span className="tag">{detail.text}</span>}
                <StageMeter stage={current.stage} />
              </div>
              {shown && detail && (
                <div className="verdict reveal" role="status">
                  <span className="tick">Answer.</span> <RevealedAnswer q={current} item={detail} />
                </div>
              )}
              {error && (
                <div className="alert" role="alert" style={{ maxWidth: 560 }}>
                  {error}{" "}
                  {stuck && (
                    <button type="button" className="linkish" onClick={dropCurrent}>
                      Move on to the next question
                    </button>
                  )}
                </div>
              )}
              <div className="row center">
                <button type="button" className="btn lg" disabled={phase === "sending"} onClick={() => void send({ self_grade: "yes" })}>
                  Nailed it
                </button>
                {!shown && (
                  <button
                    type="button"
                    className="btn quiet"
                    disabled={phase === "sending" || !detail}
                    onClick={() => setShown(true)}
                    autoFocus
                  >
                    Show
                  </button>
                )}
                <button type="button" className="btn quiet" disabled={phase === "sending"} onClick={() => void send({ self_grade: "no" })}>
                  Bummer
                </button>
                {settings.skip_enabled && !shown && (
                  <button type="button" className="btn quiet" onClick={() => void skip()} disabled={phase === "sending"}>
                    Skip
                  </button>
                )}
              </div>
              <p className="hint hint-line">
                {current.kind === "grammar"
                  ? "Grammar answers are open, so you decide whether you knew it."
                  : "Think of the answer first, then say whether you knew it."}
              </p>
            </>
          )}

          {phase !== "answered" && !cardStyle && (
            <>
              <div className="row center">
                {current.kind === "vocabulary" ? <span className="tag">{current.type}</span> : <KindTag kind={current.kind} />}
                {current.question_kind === "cloze" && detail && <span className="tag">{detail.text}</span>}
                <StageMeter stage={current.stage} />
              </div>
              <form
                className="stack"
                style={{ width: "100%", alignItems: "center", gap: 14 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void check();
                }}
              >
                <input
                  ref={inputRef}
                  className="answer"
                  type="text"
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    if (error && !stuck) setError(null);
                  }}
                  onKeyDown={(e) => {
                    // Keys that belong to the Japanese IME (Enter to confirm a conversion, Esc to undo it
                    // back to kana) must stay in the box: never submit, never move focus.
                    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
                    if (e.key === "Enter" && composing) e.preventDefault();
                    if (e.key === "Escape") e.stopPropagation();
                  }}
                  placeholder={placeholder(current)}
                  aria-label="Your answer"
                  lang={current.direction === "to_japanese" ? "ja" : undefined}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={phase === "sending"}
                />
                {current.question_kind === "reading" && current.prompt.hint && (
                  <p className="hint hint-line">{current.prompt.hint}</p>
                )}
                {error && (
                  <div className="alert" role="alert" style={{ maxWidth: 560 }}>
                    {error}{" "}
                    {stuck && (
                      <button type="button" className="linkish" onClick={dropCurrent}>
                        Move on to the next question
                      </button>
                    )}
                  </div>
                )}
                <div className="row center">
                  <button type="submit" className="btn lg" disabled={phase === "sending"}>
                    Check <span className="key">Enter</span>
                  </button>
                  {sessionType === "practice" && (
                    <button
                      type="button"
                      className="btn quiet"
                      onClick={() => void send({ revealed: true })}
                      disabled={phase === "sending"}
                      title="Shows the answer and counts this question as not correct"
                    >
                      Show answer
                    </button>
                  )}
                  {settings.skip_enabled && (
                    <button type="button" className="btn quiet" onClick={() => void skip()} disabled={phase === "sending"}>
                      Skip
                    </button>
                  )}
                </div>
              </form>
            </>
          )}

          {phase === "answered" && result && (
            <>
              <Verdict
                q={current}
                out={result}
                accepted={accepted}
                sessionType={sessionType}
                showMine={settings.show_on_wrong === "answer_and_mine"}
              />
              {detail && <Facts item={detail} />}
              {error && (
                <div className="alert" role="alert" style={{ maxWidth: 560 }}>
                  {error}
                </div>
              )}
              <div className="row center">
                <button ref={nextRef} type="button" className="btn lg" onClick={advance}>
                  Next <span className="key">Enter</span>
                </button>
                {(result.note === "self" || result.note === "regraded") && (
                  <button
                    type="button"
                    className="btn quiet"
                    disabled={regrading}
                    onClick={() => void regrade(!result.correct)}
                    title="Changes how this answer is counted"
                  >
                    {result.correct ? "Bummer, I got it wrong" : "Actually, I nailed it"}
                  </button>
                )}
                {result.can_accept && !accepted && (
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => void accept()}
                    disabled={accepting}
                    title={`Counts as correct and adds "${result.your_answer}" to this item's accepted answers`}
                  >
                    My answer was right, accept &ldquo;{result.your_answer}&rdquo;
                  </button>
                )}
                <Link className="btn quiet" href={`/${lang}/items/${current.item_id}`} target="_blank" rel="noopener">
                  Open card<span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </div>
              {autoAdvance && (
                <p className="hint hint-line" role="status">
                  Next question in {settings.auto_advance_seconds} {settings.auto_advance_seconds === 1 ? "second" : "seconds"}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function bandText(q: Question): string {
  if (q.question_kind === "cloze") return "Grammar · what fills the blank?";
  if (q.question_kind === "name_pattern") return "Grammar · what does the marked pattern mean?";
  const k = KIND_LABEL[q.kind];
  return q.direction === "to_meaning" ? `${k} · answer with the meaning` : `${k} · answer in Japanese (romaji or kana)`;
}

function placeholder(q: Question): string {
  switch (q.question_kind) {
    case "meaning":
      return "Meaning";
    case "reading":
      return "Reading in romaji or kana";
    case "cloze":
      return "Missing part";
    case "name_pattern":
      return "Meaning of the pattern";
  }
}

function highlightParts(q: Question, detail?: ItemOut): { before: string; target: string; after: string } {
  const examples = detail?.details.examples;
  if (examples && q.example_index !== null && examples[q.example_index]) {
    const m = parseMarked(examples[q.example_index].ja);
    if (m && m.before + m.target + m.after === q.prompt.text) return m;
  }
  const text = q.prompt.text;
  const hl = q.prompt.highlight;
  const at = hl ? text.lastIndexOf(hl) : -1;
  if (at < 0) return { before: text, target: "", after: "" };
  return { before: text.slice(0, at), target: hl, after: text.slice(at + hl.length) };
}

function PromptView({ q, detail }: { q: Question; detail?: ItemOut }) {
  const cls = KIND_CLASS[q.kind];
  if (q.question_kind === "cloze") {
    const [before, ...after] = q.prompt.text.split(BLANK);
    return (
      <div className={`square text ${cls}`} style={{ padding: "26px 30px" }}>
        <span className="cloze" lang="ja">
          {before}
          <span className="blank" aria-label="blank">
            &nbsp;
          </span>
          {after.join(BLANK)}
        </span>
      </div>
    );
  }
  if (q.question_kind === "name_pattern") {
    const p = highlightParts(q, detail);
    return (
      <div className={`square text ${cls}`} style={{ padding: "26px 30px" }}>
        <span className="cloze" lang="ja">
          {p.before}
          <span className="hl">{p.target}</span>
          {p.after}
        </span>
      </div>
    );
  }
  if (q.direction === "to_meaning") {
    return (
      <div className={`square ${cls}`}>
        <SquareText text={q.prompt.text} />
      </div>
    );
  }
  return (
    <div className={`square text ${cls}`}>
      <b>{q.prompt.text}</b>
    </div>
  );
}

/** The answer for a card, taken from the item details so nothing is sent before the user decides. */
function RevealedAnswer({ q, item }: { q: Question; item: ItemOut }) {
  const meanings = [item.primary_meaning, ...item.alt_meanings];
  const d = item.details;
  if (q.question_kind === "cloze") {
    const m = d.examples && q.example_index !== null ? parseMarked(d.examples[q.example_index]?.ja ?? "") : null;
    return (
      <b className="jp-text" lang="ja">
        {m?.target ?? "—"}
      </b>
    );
  }
  if (q.question_kind === "reading") {
    if (item.kind === "kanji") {
      return (
        <b className="jp-text" lang="ja">
          {[...(d.onyomi ?? []), ...(d.kunyomi ?? [])].join("、") || item.reading_kana}
        </b>
      );
    }
    return (
      <>
        <b className="jp-text" lang="ja">
          {item.reading_kana}
        </b>{" "}
        ({item.romaji})
      </>
    );
  }
  return (
    <>
      <b>{meanings[0]}</b>
      {meanings.length > 1 ? `; ${meanings.slice(1).join("; ")}` : ""}
    </>
  );
}

function Expected({ q, out }: { q: Question; out: AnswerOut }) {
  const e = out.expected;
  if (e.length === 0) return <b>—</b>;
  if (q.question_kind === "reading" && q.kind === "vocabulary") {
    return (
      <>
        <b className="jp-text" lang="ja">
          {e[0]}
        </b>
        {e[1] ? ` (${e[1]})` : ""}
      </>
    );
  }
  if (q.question_kind === "reading" || q.question_kind === "cloze") {
    return (
      <b className="jp-text" lang="ja">
        {e.join("、")}
      </b>
    );
  }
  return (
    <>
      <b>{e[0]}</b>
      {e.length > 1 ? `; ${e.slice(1).join("; ")}` : ""}
    </>
  );
}

function stageLine(
  sessionType: SessionType,
  out: AnswerOut,
  accepted: AcceptOut | null,
): string {
  if (sessionType === "practice") return "Practice does not change stages or review dates.";
  const after = accepted ? accepted.stage_after : out.stage_after;
  const next = accepted ? accepted.next_review_at : out.next_review_at;
  if (sessionType === "learn") {
    if ((out.lesson?.graduated && !accepted) || (accepted && (after ?? 0) >= 1)) {
      return `Learned. It moves to reviews at stage 1; first review ${inTime(next)}.`;
    }
    if (accepted) return "Counted as correct for this lesson pass.";
    const l = out.lesson;
    if (!l) return "";
    if (!out.correct) return `It comes back later in this session. Your pass count stays at ${l.passes}.`;
    if (l.directions_done.length === 0) return `Pass ${l.passes} of 3 done.`;
    return `Pass ${l.passes + 1} of 3: the other direction is still to come.`;
  }
  const before = out.stage_before;
  const nextText = next ? ` Next review ${inTime(next)}.` : "";
  if (before === null || after === null) return nextText.trim();
  if (after === before) return `Stays at stage ${after}${after === 7 ? ", mastered" : ""}.${nextText}`;
  return `Moves from stage ${before} to stage ${after}.${nextText}`;
}

function Verdict({
  q,
  out,
  accepted,
  sessionType,
  showMine,
}: {
  q: Question;
  out: AnswerOut;
  accepted: AcceptOut | null;
  sessionType: SessionType;
  showMine: boolean;
}) {
  const line = stageLine(sessionType, out, accepted);
  if (accepted) {
    return (
      <div className="verdict ok" role="status">
        <span className="tick">Accepted.</span> &ldquo;{out.your_answer}&rdquo; now counts as a right answer for this item.{" "}
        {line}
      </div>
    );
  }
  if (out.note === "revealed") {
    return (
      <div className="verdict bad" role="status">
        <span className="tick">Here is the answer.</span> <Expected q={q} out={out} />. Counted as not correct. {line}
      </div>
    );
  }
  if ((out.note === "self" || out.note === "regraded") && out.correct) {
    return (
      <div className="verdict ok" role="status">
        <span className="tick">Nailed it.</span> The answer is <Expected q={q} out={out} />. {line}
      </div>
    );
  }
  if ((out.note === "self" || out.note === "regraded") && !out.correct) {
    return (
      <div className="verdict bad" role="status">
        <span className="tick">Bummer.</span> The answer is <Expected q={q} out={out} />. {line}
      </div>
    );
  }
  if (out.correct) {
    if (out.note === "typo" || out.note === "long_vowel") {
      return (
        <div className="verdict ok" role="status">
          <span className="tick">{out.note === "typo" ? "Correct, with a typo." : "Correct, but check the long vowel."}</span>{" "}
          Expected <Expected q={q} out={out} />. Counted as correct. {line}
        </div>
      );
    }
    return (
      <div className="verdict ok" role="status">
        <span className="tick">Correct.</span> {line}
      </div>
    );
  }
  return (
    <div className="verdict bad" role="status">
      <span className="tick">Not this one.</span>{" "}
      {showMine && out.your_answer && (
        <>
          You typed <b>{out.your_answer}</b>.{" "}
        </>
      )}
      The answer is <Expected q={q} out={out} />. {line}
    </div>
  );
}

function Facts({ item }: { item: ItemOut }) {
  const d = item.details;
  const meanings = [item.primary_meaning, ...item.alt_meanings].join("; ");
  return (
    <dl className="facts">
      {item.kind === "vocabulary" && (
        <>
          <dt>Reading</dt>
          <dd>
            <span className="jp-text" lang="ja">
              {item.reading_kana}
            </span>{" "}
            · {item.romaji}
          </dd>
        </>
      )}
      {item.kind === "kanji" && (
        <>
          {(d.onyomi?.length ?? 0) > 0 && (
            <>
              <dt>Onyomi</dt>
              <dd className="jp-text" lang="ja">
                {d.onyomi?.join("、")}
              </dd>
            </>
          )}
          {(d.kunyomi?.length ?? 0) > 0 && (
            <>
              <dt>Kunyomi</dt>
              <dd className="jp-text" lang="ja">
                {d.kunyomi?.join("、")}
              </dd>
            </>
          )}
        </>
      )}
      {item.kind === "grammar" && (
        <>
          <dt>Entry</dt>
          <dd className="jp-text">{item.text}</dd>
          {d.pattern && (
            <>
              <dt>Pattern</dt>
              <dd>{d.pattern}</dd>
            </>
          )}
        </>
      )}
      <dt>Meaning</dt>
      <dd>{meanings}</dd>
    </dl>
  );
}
