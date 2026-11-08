"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApp } from "@/components/AppShell";
import { StageDistribution } from "@/components/bits";
import { Loading, Page } from "@/components/Page";
import { ago, longDate, whenAt } from "@/lib/format";
import type { Today } from "@/lib/types";

export default function TodayPage() {
  const { lang } = useParams<{ lang: string }>();
  const { today, workspace } = useApp();

  return (
    <Page title="Today" eyebrow={today ? longDate() : undefined}>
      {!today ? <Loading /> : <TodayBody t={today} lang={lang} languageName={workspace?.name ?? ""} />}
    </Page>
  );
}

function TodayBody({ t, lang, languageName }: { t: Today; lang: string; languageName: string }) {
  const max = Math.max(...t.forecast.map((f) => f.count), 0);
  const reviewNote = [
    t.reviews_due > 0 && t.oldest_due_at ? `Oldest waiting ${ago(t.oldest_due_at)}.` : null,
    t.next_batch ? `${t.next_batch.count} more arrive ${whenAt(t.next_batch.at)}.` : null,
    t.reviews_due === 0 && !t.next_batch ? "Nothing is scheduled in the next 24 hours." : null,
  ]
    .filter(Boolean)
    .join(" ");
  const newNote = [
    `${t.learned_today} of today's ${t.daily_cap} are learned.`,
    t.in_lessons > 0 ? `${t.in_lessons} still in lessons.` : null,
    t.next_up.length ? `Next up: ${t.next_up.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="today">
        <div>
          <p className="eyebrow">Reviews due</p>
          <span className="count">{t.reviews_due}</span>
          <p className="dim small" style={{ margin: 0 }}>
            {reviewNote}
          </p>
          <div className="row">
            <Link className={`btn lg${t.reviews_due === 0 ? " quiet" : ""}`} href={`/${lang}/review`}>
              Start review
            </Link>
          </div>
        </div>
        <div>
          <p className="eyebrow">New items</p>
          <span className="count">{t.new_available}</span>
          <p className="dim small" style={{ margin: 0 }}>
            {newNote}
          </p>
          <div className="row">
            <Link className={`btn lg${t.reviews_due > 0 || t.new_available === 0 ? " quiet" : ""}`} href={`/${lang}/learn`}>
              Start lessons
            </Link>
            <Link className="btn quiet" href={`/${lang}/practice`}>
              Extra practice
            </Link>
          </div>
        </div>
      </div>

      <div className="stats">
        <div>
          <b>
            {t.streak_days} {t.streak_days === 1 ? "day" : "days"}
          </b>
          <span>streak</span>
        </div>
        <div>
          <b>{t.reviewed_today}</b>
          <span>reviewed today</span>
        </div>
        <div>
          <b>{t.accuracy_7d === null ? "—" : `${t.accuracy_7d}%`}</b>
          <span>accuracy, last 7 days</span>
        </div>
        <div>
          <b>{t.total_items}</b>
          <span>items in {languageName || "this language"}</span>
        </div>
      </div>

      <section className="section">
        <h2>Coming up in the next 24 hours</h2>
        <div
          className="forecast"
          role="img"
          aria-label={t.forecast.map((f) => `${f.from_hours === 0 ? "now" : `+${f.from_hours}h`}: ${f.count}`).join(", ")}
        >
          {t.forecast.map((f) => (
            <i
              key={f.from_hours}
              style={{ height: `${max ? Math.round((100 * f.count) / max) : 0}%` }}
              title={`${f.count} ${f.count === 1 ? "review" : "reviews"}`}
            />
          ))}
        </div>
        <div className="forecast-axis" aria-hidden="true">
          {t.forecast.map((f) => (
            <span key={f.from_hours}>{f.from_hours === 0 ? "now" : `+${f.from_hours}h`}</span>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="between">
          <h2>Where your items are</h2>
          <Link className="small" href={`/${lang}/library`}>
            Open library
          </Link>
        </div>
        <StageDistribution dist={t.distribution} />
      </section>
    </>
  );
}
