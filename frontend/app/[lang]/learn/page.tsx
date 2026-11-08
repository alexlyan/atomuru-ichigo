"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useLeaveGuard } from "@/components/AppShell";
import { TypeChips } from "@/components/bits";
import { LearnAdvanced } from "@/components/LearnAdvanced";
import { LessonCard } from "@/components/LessonCard";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { Session } from "@/components/Session";
import { api, errorText, useApi, wsPath } from "@/lib/api";
import { hoursLabel } from "@/lib/format";
import type { ItemOut, LearnQueue, Question, Settings } from "@/lib/types";

const BATCH = 5;

type Stage = "lessons" | "drill" | "batchDone";

export default function LearnPage() {
  const { lang } = useParams<{ lang: string }>();
  const router = useRouter();
  const app = useApp();
  const [types, setTypes] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [more, setMore] = useState(0);
  const params = new URLSearchParams();
  if (types.length) params.set("types", types.join(","));
  if (categories.length) params.set("categories", categories.join("|"));
  if (more) params.set("more", String(more));
  const query = params.toString();
  const queue = useApi<LearnQueue>(wsPath(lang, `/learn/queue${query ? `?${query}` : ""}`));
  const settings = useApi<Settings>(wsPath(lang, "/settings"));

  const [stage, setStage] = useState<Stage>("lessons");
  const [index, setIndex] = useState(0);
  const [batch, setBatch] = useState<ItemOut[]>([]);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [passes, setPasses] = useState<Record<string, number>>({});
  const [graduated, setGraduated] = useState<string[]>([]);
  const graduatedRef = useRef(new Set<string>());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const waiting = useMemo(() => (queue.data ? [...queue.data.in_progress, ...queue.data.new] : []), [queue.data]);
  const lessonItems = waiting.slice(0, BATCH);
  const item = lessonItems[Math.min(index, Math.max(lessonItems.length - 1, 0))];

  useLeaveGuard(
    stage === "drill"
      ? {
          title: "Leave this lesson?",
          body: "Your answers so far are saved. Items you started stay in lessons and come back next time.",
          confirmLabel: "Leave lesson",
          cancelLabel: "Keep learning",
          routes: false,
        }
      : null,
  );

  useEffect(() => {
    if (stage === "lessons") primaryRef.current?.focus();
  }, [stage, index, item?.id]);

  const startDrill = useCallback(async () => {
    if (!lessonItems.length) return;
    setStarting(true);
    setError(null);
    const ids = lessonItems.map((i) => i.id);
    try {
      await api(wsPath(lang, "/learn/start"), { method: "POST", json: { item_ids: ids } });
      const qs = await api<Question[]>(wsPath(lang, "/learn/questions"), { method: "POST", json: { item_ids: ids } });
      graduatedRef.current = new Set();
      setGraduated([]);
      setPasses(Object.fromEntries(lessonItems.map((i) => [i.id, i.lesson_passes ?? 0])));
      setBatch(lessonItems);
      setQuestions(qs);
      setStage(qs.length ? "drill" : "batchDone");
      app.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }, [lessonItems, lang, app]);

  const fetchMore = useCallback(async () => {
    const ids = batch.filter((i) => !graduatedRef.current.has(i.id)).map((i) => i.id);
    if (!ids.length) return [];
    return api<Question[]>(wsPath(lang, "/learn/questions"), { method: "POST", json: { item_ids: ids } });
  }, [batch, lang]);

  const markGraduated = useCallback((id: string) => {
    graduatedRef.current.add(id);
    setGraduated([...graduatedRef.current]);
    setPasses((p) => ({ ...p, [id]: 3 }));
  }, []);

  const unmarkGraduated = useCallback((id: string) => {
    if (!graduatedRef.current.delete(id)) return;
    setGraduated([...graduatedRef.current]);
  }, []);

  const finishBatch = useCallback(() => {
    setStage("batchDone");
    setIndex(0);
    app.refresh();
    if (more !== 0) setMore(0);
    else queue.reload();
  }, [app, more, queue]);

  const s = settings.data;
  const q = queue.data;
  const done = batch.reduce((sum, i) => sum + Math.min(passes[i.id] ?? 0, 3), 0);

  let eyebrow = "Learn";
  if (stage === "lessons" && lessonItems.length) eyebrow = `Learn · item ${index + 1} of ${lessonItems.length}`;
  if (stage === "drill") eyebrow = `Learn · ${graduated.length} of ${batch.length} learned`;

  const typeChips = app.me && (
    <TypeChips
      types={app.me.types}
      value={types}
      onChange={(t) => {
        setTypes(t);
        setIndex(0);
      }}
    />
  );

  return (
    <Page title="Lessons" eyebrow={eyebrow}>
      {(queue.error || settings.error) && (
        <ErrorBox
          message={(queue.error ?? settings.error)?.message ?? ""}
          onRetry={() => {
            queue.reload();
            settings.reload();
          }}
        />
      )}
      {error && <ErrorBox message={error} />}

      {stage === "drill" && questions && s && (
        <Session
          lang={lang}
          sessionType="learn"
          questions={questions}
          settings={s}
          items={Object.fromEntries(batch.map((i) => [i.id, i]))}
          fetchMore={fetchMore}
          onAnswer={(question, out) => {
            if (!out.lesson) return;
            const lesson = out.lesson;
            setPasses((p) => ({ ...p, [question.item_id]: lesson.passes }));
            if (lesson.graduated) markGraduated(question.item_id);
            else unmarkGraduated(question.item_id); // the user changed their mind about the last answer
          }}
          onAccept={(question, out) => {
            if ((out.stage_after ?? 0) >= 1) markGraduated(question.item_id);
          }}
          label={({ current }) =>
            current ? `Pass ${Math.min((passes[current.item_id] ?? 0) + 1, 3)} of 3` : `${graduated.length} of ${batch.length}`
          }
          progress={batch.length ? done / (batch.length * 3) : 0}
          onFinish={finishBatch}
          onEnd={() => {
            app.clearGuards();
            router.push(`/${lang}/today`);
          }}
        />
      )}

      {stage === "batchDone" && (
        <div className="trial">
          <h2 style={{ fontSize: 28 }}>
            {batch.length === 1 ? "1 item learned." : `${batch.length} items learned.`}
          </h2>
          <p className="lead dim" style={{ textAlign: "center" }}>
            {s ? `They join your reviews at stage 1. The first review comes in ${hoursLabel(s.intervals_hours["1"] ?? 12)}.` : ""}
          </p>
          {queue.loading || !q ? (
            <Loading />
          ) : waiting.length > 0 ? (
            <div className="row center">
              <button type="button" className="btn lg" autoFocus onClick={() => setStage("lessons")}>
                Learn the next {Math.min(BATCH, waiting.length)}
              </button>
              <Link className="btn quiet" href={`/${lang}/today`}>
                Back to today
              </Link>
            </div>
          ) : (
            <div className="row center">
              {q?.cap_reached && (
                <button
                  type="button"
                  className="btn quiet"
                  onClick={() => {
                    setMore(5);
                    setStage("lessons");
                  }}
                >
                  Learn 5 more anyway
                </button>
              )}
              <Link className="btn" href={`/${lang}/review`}>
                Go to reviews
              </Link>
              <Link className="btn quiet" href={`/${lang}/today`}>
                Back to today
              </Link>
            </div>
          )}
        </div>
      )}

      {stage === "lessons" && (
        <>
          {typeChips}
          <LearnAdvanced
            lang={lang}
            types={types}
            categories={categories}
            onCategories={(c) => {
              setCategories(c);
              setIndex(0);
            }}
            onPrioritized={() => {
              setIndex(0);
              queue.reload();
            }}
          />
          {!q && queue.loading && <Loading what="Finding new items" />}
          {q && lessonItems.length === 0 && q.cap_reached && (
            <div className="trial">
              <h2 style={{ fontSize: 28 }}>See you later.</h2>
              <p className="lead dim" style={{ textAlign: "center" }}>
                You learned all {q.daily_cap} new items for today. The next lessons open tomorrow.
              </p>
              <div className="row center">
                <Link className="btn" href={`/${lang}/practice`}>
                  Practice what you know
                </Link>
                <button type="button" className="btn quiet" onClick={() => setMore(5)}>
                  Learn 5 more anyway
                </button>
              </div>
            </div>
          )}
          {q && lessonItems.length === 0 && !q.cap_reached && (
            <div className="trial">
              <h2 style={{ fontSize: 28 }}>No new items yet</h2>
              <p className="lead dim" style={{ textAlign: "center" }}>
                {q.waiting > 0
                  ? "The items waiting here can't be learned yet. A grammar entry needs an example sentence with the grammar part in [brackets]."
                  : types.length || categories.length
                    ? "Nothing new matches these filters. Pick All, or add more items."
                    : "Everything in your library has been learned. Add words, kanji or grammar to keep going."}
              </p>
              <div className="row center">
                <Link className="btn" href={`/${lang}/add`}>
                  Add items
                </Link>
                {q.waiting > 0 && (
                  <Link className="btn quiet" href={`/${lang}/library?tab=grammar&stages=new`}>
                    Open grammar in the library
                  </Link>
                )}
              </div>
            </div>
          )}
          {item && (
            <LessonCard item={item}>
              <div className="row">
                {index < lessonItems.length - 1 ? (
                  <>
                    <button ref={primaryRef} type="button" className="btn lg" onClick={() => setIndex((i) => i + 1)}>
                      Next item <span className="key">Enter</span>
                    </button>
                    {index > 0 && (
                      <button type="button" className="btn quiet" onClick={() => setIndex((i) => i - 1)}>
                        Previous
                      </button>
                    )}
                    <button type="button" className="btn quiet" onClick={() => void startDrill()} disabled={starting || !s}>
                      Start drill now
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      ref={primaryRef}
                      type="button"
                      className="btn lg"
                      onClick={() => void startDrill()}
                      disabled={starting || !s}
                    >
                      {starting ? "Starting…" : "Start drill"} <span className="key">Enter</span>
                    </button>
                    {index > 0 && (
                      <button type="button" className="btn quiet" onClick={() => setIndex((i) => i - 1)}>
                        Previous
                      </button>
                    )}
                  </>
                )}
                <Link className="btn quiet" href={`/${lang}/items/${item.id}`}>
                  Open full card
                </Link>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                The drill asks each item both ways. Three correct passes move it to reviews.
              </p>
            </LessonCard>
          )}
        </>
      )}
    </Page>
  );
}
