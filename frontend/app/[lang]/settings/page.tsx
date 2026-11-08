"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { api, errorText, useApi, wsPath } from "@/lib/api";
import { hoursLabel } from "@/lib/format";
import type { Settings } from "@/lib/types";

type Tab = "lang" | "account" | "languages";

export default function SettingsPage() {
  const { lang } = useParams<{ lang: string }>();
  const { workspace } = useApp();
  const [tab, setTab] = useState<Tab>("lang");
  const name = workspace?.name ?? "This language";

  return (
    <Page title="Settings" eyebrow={`${name} workspace and account`}>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {(
          [
            ["lang", name],
            ["account", "Account and data"],
            ["languages", "Languages"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "on" : undefined}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "lang" && <WorkspaceSettingsForm lang={lang} />}
      {tab === "account" && <Account lang={lang} />}
      {tab === "languages" && <Languages />}
    </Page>
  );
}

function WorkspaceSettingsForm({ lang }: { lang: string }) {
  const remote = useApi<Settings>(wsPath(lang, "/settings"));
  const [form, setForm] = useState<Settings | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (remote.data) setForm(remote.data);
  }, [remote.data]);

  if (remote.error) return <ErrorBox message={remote.error.message} onRetry={remote.reload} />;
  if (!form) return <Loading />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setStatus(null);
  };

  const problems: string[] = [];
  if (!Number.isInteger(form.new_per_day) || form.new_per_day < 1 || form.new_per_day > 200) {
    problems.push("New items per day must be a whole number from 1 to 200.");
  }
  if (!Number.isInteger(form.session_size) || form.session_size < 5 || form.session_size > 500) {
    problems.push("Questions per review session must be a whole number from 5 to 500.");
  }

  const save = async () => {
    if (problems.length) {
      setStatus({ ok: false, text: problems.join(" ") });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const out = await api<Settings>(wsPath(lang, "/settings"), { method: "PUT", json: form });
      setForm(out);
      remote.setData(out);
      setStatus({ ok: true, text: "Saved." });
    } catch (e) {
      setStatus({ ok: false, text: `Not saved: ${errorText(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const intervals = form.intervals_hours;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="section">
        <h2>Lessons and sessions</h2>
        <div className="fieldset">
          <div>
            <label htmlFor="s1">New items per day</label>
            <input
              id="s1"
              type="number"
              min={1}
              max={200}
              value={Number.isNaN(form.new_per_day) ? "" : form.new_per_day}
              onChange={(e) => set("new_per_day", e.target.valueAsNumber)}
            />
            <div className="hint">&ldquo;Learn 5 more anyway&rdquo; can go past this.</div>
          </div>
          <div>
            <label htmlFor="s2">Questions per review session</label>
            <input
              id="s2"
              type="number"
              min={5}
              max={500}
              value={Number.isNaN(form.session_size) ? "" : form.session_size}
              onChange={(e) => set("session_size", e.target.valueAsNumber)}
            />
          </div>
        </div>
      </section>
      <section className="section">
        <h2>Checking answers</h2>
        <div className="fieldset">
          <div>
            <label htmlFor="s3">Typo tolerance</label>
            <select id="s3" value={form.typo_tolerance} onChange={(e) => set("typo_tolerance", e.target.value as Settings["typo_tolerance"])}>
              <option value="strict">Strict</option>
              <option value="normal">Normal</option>
              <option value="forgiving">Forgiving</option>
            </select>
            <div className="hint">How close a typed answer must be to count.</div>
          </div>
          <div>
            <label htmlFor="s4">Review direction</label>
            <select
              id="s4"
              value={form.review_direction}
              onChange={(e) => set("review_direction", e.target.value as Settings["review_direction"])}
            >
              <option value="both">Both, mixed</option>
              <option value="to_meaning">Japanese to meaning only</option>
              <option value="to_japanese">Meaning to Japanese only</option>
            </select>
          </div>
        </div>
      </section>
      <section className="section">
        <h2>Pace during a session</h2>
        <div className="fieldset">
          <div>
            <label htmlFor="s5">After an answer</label>
            <select id="s5" value={form.after_answer} onChange={(e) => set("after_answer", e.target.value as Settings["after_answer"])}>
              <option value="wait">Wait until I press Enter</option>
              <option value="advance_if_correct">Move on when correct, wait when wrong</option>
              <option value="always_advance">Always move on</option>
            </select>
          </div>
          <div>
            <label htmlFor="s6">Move-on delay</label>
            <select
              id="s6"
              value={form.auto_advance_seconds}
              onChange={(e) => set("auto_advance_seconds", Number(e.target.value) as Settings["auto_advance_seconds"])}
            >
              <option value={1}>1 second</option>
              <option value={2}>2 seconds</option>
              <option value={4}>4 seconds</option>
            </select>
          </div>
          <div>
            <label htmlFor="s7">Skip button</label>
            <select id="s7" value={form.skip_enabled ? "shown" : "hidden"} onChange={(e) => set("skip_enabled", e.target.value === "shown")}>
              <option value="hidden">Hidden</option>
              <option value="shown">Shown</option>
            </select>
            <div className="hint">Skipped questions return at the end of the session and change nothing.</div>
          </div>
          <div>
            <label htmlFor="s8">On a wrong answer show</label>
            <select id="s8" value={form.show_on_wrong} onChange={(e) => set("show_on_wrong", e.target.value as Settings["show_on_wrong"])}>
              <option value="answer_and_mine">The answer and what I typed</option>
              <option value="answer_only">The answer only</option>
            </select>
          </div>
        </div>
      </section>
      <section className="section">
        <h2>Review intervals</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Next review after</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>New</td>
                <td>3 correct passes in lessons</td>
              </tr>
              {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                <tr key={s}>
                  <td>{s === 7 ? "7, mastered" : s}</td>
                  <td className="mono">
                    {intervals[String(s)] ? hoursLabel(intervals[String(s)]) : "—"}
                    {s === 7 ? ", repeating" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="settings-actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {status && (
          <span role="status" className={status.ok ? "ok-text" : "bad-text"}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}

function Account({ lang }: { lang: string }) {
  const { me } = useApp();
  return (
    <div className="stack">
      <div className="between">
        <div>
          <b>Account</b>
          <div className="hint">Signed in as {me?.user.email ?? "…"}</div>
        </div>
        <button type="button" className="btn quiet" disabled title="Coming soon">
          Sign out (coming soon)
        </button>
      </div>
      <div className="between">
        <div>
          <b>Export</b>
          <div className="hint">Items and answer history as CSV</div>
        </div>
        <button type="button" className="btn quiet" disabled title="Coming soon">
          Export CSV (coming soon)
        </button>
      </div>
      <div className="between">
        <div>
          <b>Import history</b>
          <div className="hint">Undo an import until you start learning from it</div>
        </div>
        <Link className="btn quiet" href={`/${lang}/add`}>
          View imports
        </Link>
      </div>
    </div>
  );
}

function Languages() {
  const { me, workspace, switchLanguage, addLanguage } = useApp();
  const [error, setError] = useState<string | null>(null);
  if (!me) return <Loading />;
  return (
    <div className="stack">
      {me.workspaces.map((w) => (
        <div key={w.language} className="between">
          <span>
            <span className="jp-text" lang={w.language}>
              {w.native_name}
            </span>{" "}
            {w.name} <span className="dim small">· {w.due} due</span>
          </span>
          {w.language === workspace?.language ? (
            <span className="status ok">active</span>
          ) : (
            <button type="button" className="btn quiet" onClick={() => switchLanguage(w.language)}>
              Switch to {w.name}
            </button>
          )}
        </div>
      ))}
      {me.available_languages.map((l) => (
        <div key={l.language} className="between">
          <span className={l.supported ? undefined : "dim"}>
            <span lang={l.language}>{l.native_name}</span> {l.name}
          </span>
          {l.supported ? (
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                setError(null);
                addLanguage(l.language).catch((e: unknown) => setError(errorText(e)));
              }}
            >
              Add {l.name}
            </button>
          ) : (
            <span className="status warn">coming soon</span>
          )}
        </div>
      ))}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
