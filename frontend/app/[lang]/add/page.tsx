"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp, useLeaveGuard } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ItemForm, emptyForm, formErrors, formIsBlank, formToPayload, formWarnings, type FormState } from "@/components/ItemForm";
import { ErrorBox, Page } from "@/components/Page";
import { ApiError, api, errorText, useApi, wsPath } from "@/lib/api";
import { KIND_LABEL, whenAt } from "@/lib/format";
import type { ImportRow, ImportSummary, ItemOut, Kind } from "@/lib/types";

export default function AddPage() {
  return (
    <Suspense fallback={null}>
      <Add />
    </Suspense>
  );
}

function Add() {
  const { lang } = useParams<{ lang: string }>();
  const search = useSearchParams();
  const { workspace } = useApp();
  const [tab, setTab] = useState<"bulk" | "manual">(search.get("tab") === "manual" ? "manual" : "bulk");

  return (
    <Page title={`Add to ${workspace?.name ?? "your library"}`} eyebrow="Bulk import or one item at a time">
      <div className="tabs" role="tablist" aria-label="How to add">
        <button type="button" role="tab" aria-selected={tab === "bulk"} className={tab === "bulk" ? "on" : undefined} onClick={() => setTab("bulk")}>
          Bulk import
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          className={tab === "manual" ? "on" : undefined}
          onClick={() => setTab("manual")}
        >
          Manual
        </button>
      </div>
      <div hidden={tab !== "bulk"} className="stack">
        <BulkImport lang={lang} />
      </div>
      <div hidden={tab !== "manual"} className="stack">
        <ManualAdd lang={lang} />
      </div>
    </Page>
  );
}

/* ---------------- Bulk import ---------------- */

const STATUS_CLASS: Record<ImportRow["status"], string> = { new: "ok", update: "info", warning: "warn", error: "bad" };

function rowResult(r: ImportRow): string {
  if (r.status === "new") return "new";
  if (r.status === "update") return r.messages.length ? `updates existing, stage kept; ${r.messages.join("; ")}` : "updates existing, stage kept";
  return r.messages.join("; ") || r.status;
}

function Steps({ now }: { now: number }) {
  const names = ["Upload", "Validate", "Preview", "Confirm"];
  return (
    <div className="steps" aria-label="Import steps">
      {names.map((n, i) => (
        <span key={n} className={i < now ? "done" : i === now ? "now" : undefined} aria-current={i === now ? "step" : undefined}>
          {n}
        </span>
      ))}
    </div>
  );
}

function BulkImport({ lang }: { lang: string }) {
  const [kind, setKind] = useState<"vocabulary" | "kanji">("vocabulary");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [batch, setBatch] = useState<ImportSummary | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const history = useApi<ImportSummary[]>(wsPath(lang, "/imports"));

  const reset = (msg: string | null) => {
    setBatch(null);
    setFile(null);
    setInputKey((k) => k + 1);
    setStep("upload");
    setError(null);
    setUndone(null);
    setMessage(msg);
    history.reload();
  };

  const upload = async () => {
    if (!file) {
      setError("Choose a .csv or .xlsx file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const out = await api<ImportSummary>(wsPath(lang, "/imports"), { method: "POST", body });
      setBatch(out);
      setStep("preview");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (msg: string) => {
    if (!batch) return reset(null);
    setBusy(true);
    try {
      await api(wsPath(lang, `/imports/${batch.id}`), { method: "DELETE" });
      reset(msg);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<ImportSummary>(wsPath(lang, `/imports/${batch.id}/commit`), { method: "POST" });
      setBatch(out);
      setStep("done");
      history.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ removed: number }>(wsPath(lang, `/imports/${id}/undo`), { method: "POST" });
      if (batch?.id === id) setUndone(out.removed);
      else setMessage(`Import undone. ${out.removed} ${out.removed === 1 ? "item was" : "items were"} removed.`);
      history.reload();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? e.message : `Could not undo: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (step === "preview" && batch) {
    const rows = batch.rows ?? [];
    return (
      <>
        <Steps now={2} />
        <div className="between">
          <div>
            <b>{batch.filename}</b>
            <div className="hint">
              {KIND_LABEL[batch.kind]} · {rows.length} {rows.length === 1 ? "row" : "rows"} · not saved yet
              {batch.expires_at ? `, the preview expires ${whenAt(batch.expires_at)}` : ""}
            </div>
          </div>
          <a className="btn quiet" href={wsPath(lang, `/imports/template?kind=${batch.kind}`)} download>
            Download template
          </a>
        </div>
        <div className="row">
          <span className="status ok">{batch.counts.new} new</span>
          <span className="status info">{batch.counts.update} update existing</span>
          <span className="status warn">
            {batch.counts.warning} {batch.counts.warning === 1 ? "warning" : "warnings"}
          </span>
          <span className="status bad">
            {batch.counts.error} {batch.counts.error === 1 ? "error" : "errors"}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              {batch.kind === "vocabulary" ? (
                <tr>
                  <th>Row</th>
                  <th>japanese</th>
                  <th>romaji</th>
                  <th>meaning</th>
                  <th>type</th>
                  <th>Result</th>
                </tr>
              ) : (
                <tr>
                  <th>Row</th>
                  <th>character</th>
                  <th>meaning</th>
                  <th>onyomi</th>
                  <th>kunyomi</th>
                  <th>Result</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.data;
                const meaning = d ? [d.primary_meaning, ...d.alt_meanings].join("; ") : "—";
                return (
                  <tr key={r.row}>
                    <td className="n">{r.row}</td>
                    {batch.kind === "vocabulary" ? (
                      <>
                        <td className="jp-text" lang="ja">
                          {d?.text ?? "—"}
                        </td>
                        <td>{d?.romaji ?? "—"}</td>
                        <td>{meaning}</td>
                        <td>{d?.word_type ?? ""}</td>
                      </>
                    ) : (
                      <>
                        <td className="jp-text" lang="ja">
                          {d?.text ?? "—"}
                        </td>
                        <td>{meaning}</td>
                        <td className="jp-text" lang="ja">
                          {d?.details?.onyomi?.join("、") ?? ""}
                        </td>
                        <td className="jp-text" lang="ja">
                          {d?.details?.kunyomi?.join("、") ?? ""}
                        </td>
                      </>
                    )}
                    <td>
                      <span className={`status ${STATUS_CLASS[r.status]}`}>{rowResult(r)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="between">
          <button type="button" className="btn danger" onClick={() => void cancel("Import cancelled. Nothing was saved.")} disabled={busy}>
            Cancel import
          </button>
          <div className="row">
            <button type="button" className="btn quiet" onClick={() => void cancel("Preview discarded. Fix the file and upload it again.")} disabled={busy}>
              Fix the file and upload again
            </button>
            <button type="button" className="btn" onClick={() => void commit()} disabled={busy || batch.importable === 0}>
              {busy ? "Importing…" : `Import ${batch.importable} valid ${batch.importable === 1 ? "row" : "rows"}`}
            </button>
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Nothing is saved until you import. Rows with errors are left out. You can undo this import until you start
          learning any item from it.
        </p>
      </>
    );
  }

  if (step === "done" && batch) {
    return (
      <>
        <Steps now={undone === null ? 3 : 4} />
        <div className="box stack">
          {undone === null ? (
            <>
              <h2>Imported {batch.importable} {batch.importable === 1 ? "row" : "rows"}.</h2>
              <p className="dim" style={{ margin: 0 }}>
                {batch.counts.new + batch.counts.warning} new {batch.counts.new + batch.counts.warning === 1 ? "item" : "items"} wait in
                your lessons; {batch.counts.update} existing {batch.counts.update === 1 ? "item was" : "items were"} updated with
                their stages kept.
              </p>
            </>
          ) : (
            <>
              <h2>Import undone.</h2>
              <p className="dim" style={{ margin: 0 }}>
                {undone} {undone === 1 ? "item was" : "items were"} removed. Updates to existing items stay as they are.
              </p>
            </>
          )}
          {error && <ErrorBox message={error} />}
          <div className="row">
            <Link className="btn" href={`/${lang}/learn`}>
              Start lessons
            </Link>
            <Link className="btn quiet" href={`/${lang}/library`}>
              Open library
            </Link>
            <button type="button" className="btn quiet" onClick={() => reset(null)}>
              Import another file
            </button>
            {undone === null && (
              <button type="button" className="btn danger" onClick={() => void undo(batch.id)} disabled={busy}>
                Undo this import
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Steps now={0} />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <form
        className="box stack"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <div className="file-row">
          <div>
            <label htmlFor="import-file">File</label>
            <input
              key={inputKey}
              id="import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <div className="hint">CSV (UTF-8) or Excel .xlsx, up to 2 MB and 2000 rows.</div>
          </div>
          <div>
            <label htmlFor="import-kind">What the file holds</label>
            <select id="import-kind" value={kind} onChange={(e) => setKind(e.target.value as "vocabulary" | "kanji")}>
              <option value="vocabulary">Vocabulary</option>
              <option value="kanji">Kanji</option>
            </select>
            <div className="hint">Grammar is added one entry at a time.</div>
          </div>
          <div className="submit-cell">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Checking…" : "Upload and check"}
            </button>
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="row">
          <a className="btn quiet" href={wsPath(lang, `/imports/template?kind=${kind}`)} download>
            Download {kind} template
          </a>
          <span className="hint">Fill the template, save it, then upload it here. You see a preview before anything is saved.</span>
        </div>
      </form>

      {history.data && history.data.length > 0 && (
        <section className="section">
          <h2>Recent imports</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Kind</th>
                  <th>Rows</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.data.slice(0, 10).map((b) => (
                  <tr key={b.id}>
                    <td>{b.filename}</td>
                    <td>{KIND_LABEL[b.kind]}</td>
                    <td className="n">{b.importable}</td>
                    <td>
                      <span className={`status ${b.status === "committed" ? "ok" : b.status === "staged" ? "info" : "warn"}`}>
                        {b.status === "committed" ? "imported" : b.status === "staged" ? "preview" : b.status}
                      </span>
                    </td>
                    <td>
                      {b.status === "committed" && (
                        <button type="button" className="btn quiet" onClick={() => void undo(b.id)} disabled={busy}>
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/* ---------------- Manual add ---------------- */

function ManualAdd({ lang }: { lang: string }) {
  const { me } = useApp();
  const [form, setForm] = useState<FormState>(() => emptyForm("vocabulary"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<{ message: string; existing_id: string } | null>(null);
  const [saved, setSaved] = useState<ItemOut | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = !formIsBlank(form);

  useLeaveGuard(
    dirty
      ? {
          title: "Discard this item?",
          body: "It has not been saved. Leaving this page or switching language will lose it.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          routes: true,
          unload: true,
        }
      : null,
  );

  const save = async (onDuplicate: "error" | "update" | "keep_both" = "error") => {
    const problems = formErrors(form);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const out = await api<ItemOut>(wsPath(lang, `/items?on_duplicate=${onDuplicate}`), {
        method: "POST",
        json: formToPayload(form),
      });
      setDup(null);
      setSaved(out);
      setForm(emptyForm(form.kind));
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { message?: string; existing_id?: string } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 409 && detail?.existing_id) {
        setDup({ message: detail.message ?? `${form.text} is already in your library.`, existing_id: detail.existing_id });
      } else {
        setError(errorText(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const wordTypes = (me?.types ?? []).filter((t) => t !== "kanji" && t !== "grammar");

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div style={{ maxWidth: 260 }}>
        <label htmlFor="item-kind">Item type</label>
        <select
          id="item-kind"
          value={form.kind}
          onChange={(e) => {
            setForm((f) => ({ ...f, kind: e.target.value as Kind }));
            setDup(null);
          }}
        >
          <option value="vocabulary">Vocabulary</option>
          <option value="kanji">Kanji</option>
          <option value="grammar">Grammar</option>
        </select>
      </div>
      {saved && (
        <div className="notice" role="status">
          <b>Saved.</b> {saved.text} is in your library and waits in your lessons.{" "}
          <Link href={`/${lang}/items/${saved.id}`}>Open it</Link>
        </div>
      )}
      <ItemForm
        value={form}
        onChange={(patch) => {
          setForm((f) => ({ ...f, ...patch }));
          setSaved(null);
          if (patch.text !== undefined) setDup(null);
        }}
        wordTypes={wordTypes}
      />
      {formWarnings(form).map((w) => (
        <p key={w} className="hint" style={{ margin: 0 }}>
          {w}
        </p>
      ))}
      {dup && (
        <div className="notice" role="alert">
          <b>{dup.message}</b> <Link href={`/${lang}/items/${dup.existing_id}`}>Open it</Link> ·{" "}
          <button type="button" className="linkish" onClick={() => void save("update")} disabled={saving}>
            Update it
          </button>{" "}
          ·{" "}
          <button type="button" className="linkish" onClick={() => void save("keep_both")} disabled={saving}>
            Save as a separate item
          </button>
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <div className="row">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn quiet" onClick={() => (dirty ? setConfirmDiscard(true) : undefined)} disabled={!dirty}>
          Cancel
        </button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this item?"
        body="It has not been saved. The form will be cleared."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          setForm(emptyForm(form.kind));
          setDup(null);
          setError(null);
        }}
      />
    </form>
  );
}
