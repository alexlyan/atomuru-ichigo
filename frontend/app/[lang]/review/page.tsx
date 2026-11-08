"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { useApp, useLeaveGuard } from "@/components/AppShell";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { Session, type SessionStats } from "@/components/Session";
import { useApi, wsPath } from "@/lib/api";
import { whenAt } from "@/lib/format";
import type { Question, Settings } from "@/lib/types";

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <Review />
    </Suspense>
  );
}

function Review() {
  const { lang } = useParams<{ lang: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const app = useApp();
  const types = search.get("types");
  const queue = useApi<Question[]>(wsPath(lang, `/review/queue${types ? `?types=${encodeURIComponent(types)}` : ""}`));
  const settings = useApi<Settings>(wsPath(lang, "/settings"));
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState<SessionStats | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const running = !finished && !queue.loading && (queue.data?.length ?? 0) > 0;
  useLeaveGuard(
    running && progress.done < progress.total
      ? {
          title: "End this review session?",
          body: "Answers you already gave are saved. The rest of the queue stays due.",
          confirmLabel: "End session",
          cancelLabel: "Keep reviewing",
          routes: false,
        }
      : null,
  );

  const onProgress = useCallback((done: number, total: number) => setProgress({ done, total }), []);
  const onFinish = useCallback(
    (stats: SessionStats) => {
      setFinished(stats);
      app.refresh();
    },
    [app],
  );

  const nextRound = () => {
    setFinished(null);
    setRound((r) => r + 1);
    queue.reload();
  };

  const t = app.today;
  const nextText = t?.next_batch
    ? `The next ${t.next_batch.count === 1 ? "review arrives" : `${t.next_batch.count} reviews arrive`} ${whenAt(t.next_batch.at)}.`
    : "Nothing else is due in the next 24 hours.";

  const eyebrow = running ? `Review · ${progress.done} of ${progress.total}` : "Review";
  const error = queue.error ?? settings.error;

  return (
    <Page title="Reviews" eyebrow={eyebrow}>
      {error && (
        <ErrorBox
          message={error.message}
          onRetry={() => {
            queue.reload();
            settings.reload();
          }}
        />
      )}
      {(queue.loading || settings.loading) && !error && <Loading what="Getting your reviews" />}

      {finished && (
        <div className="trial">
          <h2 style={{ fontSize: 28 }}>Reviews done.</h2>
          <p className="lead dim" style={{ textAlign: "center" }}>
            {finished.answered === 0
              ? "You skipped every question, so nothing changed."
              : `${finished.correct} of ${finished.answered} correct.`}{" "}
            {t && t.reviews_due > 0 ? `${t.reviews_due} more are due now.` : nextText}
          </p>
          <div className="row center">
            {t && t.reviews_due > 0 ? (
              <button type="button" className="btn lg" autoFocus onClick={nextRound}>
                Review the next {Math.min(t.reviews_due, settings.data?.session_size ?? t.reviews_due)}
              </button>
            ) : (
              <Link className="btn" href={`/${lang}/practice`}>
                Practice instead
              </Link>
            )}
            <Link className="btn quiet" href={`/${lang}/today`}>
              Back to today
            </Link>
          </div>
        </div>
      )}

      {!finished && !queue.loading && queue.data && queue.data.length === 0 && (
        <div className="trial">
          <h2 style={{ fontSize: 28 }}>See you later.</h2>
          <p className="lead dim" style={{ textAlign: "center" }}>
            Nothing is due right now{types ? " for these types" : ""}. {t?.next_batch ? nextText : "Nothing is scheduled in the next 24 hours."}
          </p>
          <div className="row center">
            <Link className="btn" href={`/${lang}/practice`}>
              Practice instead
            </Link>
            <Link className="btn quiet" href={`/${lang}/today`}>
              Back to today
            </Link>
          </div>
        </div>
      )}

      {running && settings.data && queue.data && (
        <Session
          key={round}
          lang={lang}
          sessionType="review"
          questions={queue.data}
          settings={settings.data}
          onProgress={onProgress}
          onFinish={onFinish}
          onEnd={() => {
            app.clearGuards();
            app.refresh();
            router.push(`/${lang}/today`);
          }}
        />
      )}
    </Page>
  );
}
