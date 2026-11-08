"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useApp, useLeaveGuard } from "@/components/AppShell";
import { KindTag, MarkedSentence, SquareText, StageMeter } from "@/components/bits";
import { Markdown } from "@/components/Markdown";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ItemForm, formErrors, formFromItem, formToPayload, formWarnings, type FormState } from "@/components/ItemForm";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { Session, type SessionStats } from "@/components/Session";
import { api, errorText, useApi, wsPath } from "@/lib/api";
import { KIND_CLASS, KIND_LABEL, inTime, parseMarked } from "@/lib/format";
import type { ItemOut, ItemSummary, Question, Settings } from "@/lib/types";

const WORD_TYPES_FALLBACK = ["verb", "noun", "i-adjective", "na-adjective", "adverb", "particle", "expression"];

/** practice/queue cannot pick one item, so "Drill this card" builds the same two questions here. */
function drillQuestions(item: ItemOut): Question[] {
  const base = { item_id: item.id, kind: item.kind, type: item.type, stage: item.stage };
  if (item.kind === "grammar") {
    const marked = (item.details.examples ?? [])
      .map((e, i) => ({ e, i, m: parseMarked(e.ja) }))
      .filter((x): x is { e: typeof x.e; i: number; m: NonNullable<typeof x.m> } => x.m !== null);
    if (!marked.length) return [];
    const pick = () => marked[Math.floor(Math.random() * marked.length)];
    const a = pick();
    const b = pick();
    return [
      {
        ...base,
        direction: "to_japanese",
        question_kind: "cloze",
        example_index: a.i,
        prompt: { text: `${a.m.before}＿＿＿${a.m.after}`, hint: a.e.translation ?? "", highlight: "" },
      },
      {
        ...base,
        direction: "to_meaning",
        question_kind: "name_pattern",
        example_index: b.i,
        prompt: { text: `${b.m.before}${b.m.target}${b.m.after}`, hint: "", highlight: b.m.target },
      },
    ];
  }
  return [
    { ...base, direction: "to_meaning", question_kind: "meaning", example_index: null, prompt: { text: item.text, hint: "", highlight: "" } },
    {
      ...base,
      direction: "to_japanese",
      question_kind: "reading",
      example_index: null,
      prompt: { text: item.primary_meaning, hint: item.kind === "kanji" ? "Type a reading of this kanji" : "", highlight: "" },
    },
  ];
}

export default function CardPage() {
  const { lang, id } = useParams<{ lang: string; id: string }>();
  const router = useRouter();
  const { me, clearGuards } = useApp();
  const item = useApi<ItemOut>(wsPath(lang, `/items/${id}`));
  const settings = useApi<Settings>(wsPath(lang, "/settings"));
  const [mode, setMode] = useState<"view" | "edit" | "drill">("view");
  const [drill, setDrill] = useState<{ questions: Question[]; round: number } | null>(null);
  const [drillDone, setDrillDone] = useState<SessionStats | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const it = item.data;
  const dirty = mode === "edit" && it && form ? JSON.stringify(form) !== JSON.stringify(formFromItem(it)) : false;
  useLeaveGuard(
    dirty
      ? {
          title: "Discard your changes?",
          body: "Your edits to this card have not been saved. Leaving this page or switching language will lose them.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          routes: true,
          unload: true,
        }
      : null,
  );

  const startDrill = useCallback(() => {
    if (!it) return;
    setDrill((d) => ({ questions: drillQuestions(it), round: (d?.round ?? 0) + 1 }));
    setDrillDone(null);
    setMode("drill");
  }, [it]);

  if (!it) {
    return (
      <Page title="Card" eyebrow="Library">
        {item.error ? (
          <>
            <ErrorBox message={item.error.message} onRetry={item.error.status === 404 ? undefined : item.reload} />
            <Link className="small" href={`/${lang}/library`}>
              Back to library
            </Link>
          </>
        ) : (
          <Loading />
        )}
      </Page>
    );
  }

  const added = new Date(it.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const eyebrow = `${KIND_LABEL[it.kind]} · added ${added}`;

  if (mode === "drill" && drill && settings.data) {
    return (
      <Page title={it.text} eyebrow={`${eyebrow} · drilling`}>
        {drillDone ? (
          <div className="trial">
            <h2 style={{ fontSize: 28 }}>Drill done.</h2>
            <p className="lead dim" style={{ textAlign: "center" }}>
              {drillDone.correct} of {drillDone.answered} correct. The schedule did not change.
            </p>
            <div className="row center">
              <button type="button" className="btn lg" onClick={startDrill} autoFocus>
                Drill again
              </button>
              <button
                type="button"
                className="btn quiet"
                onClick={() => {
                  setMode("view");
                  item.reload();
                }}
              >
                Back to the card
              </button>
            </div>
          </div>
        ) : (
          <Session
            key={drill.round}
            lang={lang}
            sessionType="practice"
            questions={drill.questions}
            settings={settings.data}
            items={{ [it.id]: it }}
            onFinish={setDrillDone}
            onEnd={() => {
              setMode("view");
              item.reload();
            }}
          />
        )}
      </Page>
    );
  }

  const save = async () => {
    if (!form) return;
    const problems = formErrors(form);
    if (problems.length) {
      setEditError(problems.join(" "));
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const out = await api<ItemOut>(wsPath(lang, `/items/${it.id}`), {
        method: "PATCH",
        json: formToPayload(form, it.details),
      });
      item.setData(out);
      clearGuards();
      setMode("view");
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title={it.text} eyebrow={eyebrow}>
      <Link className="small" href={`/${lang}/library`}>
        Back to library
      </Link>

      {mode === "edit" && form ? (
        <div className="box stack">
          <h2>Edit {it.text}</h2>
          <ItemForm
            value={form}
            onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
            wordTypes={me?.types.filter((t) => t !== "kanji" && t !== "grammar") ?? WORD_TYPES_FALLBACK}
          />
          {formWarnings(form).map((w) => (
            <p key={w} className="hint" style={{ margin: 0 }}>
              {w}
            </p>
          ))}
          {editError && <ErrorBox message={editError} />}
          <div className="row">
            <button type="button" className="btn" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                setMode("view");
                setEditError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <CardView
          it={it}
          lang={lang}
          onChange={item.setData}
          onDrill={startDrill}
          drillReady={!!settings.data}
          onEdit={() => {
            setForm(formFromItem(it));
            setMode("edit");
          }}
          onDelete={() => setConfirmDelete(true)}
        />
      )}
      {deleteError && <ErrorBox message={deleteError} />}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${it.text}?`}
        body="This removes the item and its answer history from your library. It can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete item"}
        cancelLabel="Keep it"
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            await api(wsPath(lang, `/items/${it.id}`), { method: "DELETE" });
            setConfirmDelete(false);
            router.push(`/${lang}/library`);
          } catch (e) {
            setConfirmDelete(false);
            setDeleteError(`Could not delete: ${errorText(e)}`);
          } finally {
            setDeleting(false);
          }
        }}
      />
    </Page>
  );
}

function scheduleText(it: ItemOut): string {
  if (it.stage === null) return "Not started yet";
  if (it.stage === 0) return "In lessons";
  if (!it.next_review_at) return `Stage ${it.stage}`;
  const when = inTime(it.next_review_at);
  return when === "now" ? "Due for review now" : `Next review ${when}`;
}

function CardView({
  it,
  lang,
  onChange,
  onDrill,
  drillReady,
  onEdit,
  onDelete,
}: {
  it: ItemOut;
  lang: string;
  onChange: (item: ItemOut) => void;
  onDrill: () => void;
  drillReady: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const d = it.details;
  const cls = KIND_CLASS[it.kind];
  const [addingCat, setAddingCat] = useState(false);
  const [cat, setCat] = useState("");
  const [addingSyn, setAddingSyn] = useState(false);
  const [syn, setSyn] = useState("");
  const [note, setNote] = useState(it.note);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    const out = await api<ItemOut>(wsPath(lang, `/items/${it.id}`), { method: "PATCH", json: body });
    onChange(out);
    return out;
  };

  const addCategory = async () => {
    const value = cat.trim();
    if (!value) return;
    try {
      await patch({ categories: [...it.categories, value] });
      setCat("");
      setAddingCat(false);
    } catch (e) {
      setError(`Could not add the category: ${errorText(e)}`);
    }
  };

  const addSynonym = async () => {
    const value = syn.trim();
    if (!value) return;
    try {
      const out = await api<ItemOut>(wsPath(lang, `/items/${it.id}/synonyms`), { method: "POST", json: { text: value } });
      onChange(out);
      setSyn("");
      setAddingSyn(false);
    } catch (e) {
      setError(`Could not add the answer: ${errorText(e)}`);
    }
  };

  const saveNote = async () => {
    if (note === it.note) return;
    setNoteStatus("Saving…");
    try {
      await patch({ note });
      setNoteStatus("Saved.");
    } catch (e) {
      setNoteStatus(`Not saved: ${errorText(e)} Click outside the box to try again.`);
    }
  };

  const patterns = d.patterns ?? [];
  const sentences = d.sentences ?? [];

  return (
    <>
      <div className={it.kind === "grammar" ? "stack grammar-hero" : "word"}>
        {it.kind === "grammar" ? (
          <div className={`pattern-box ${cls}`}>
            <span className="eyebrow">Pattern</span>
            <b lang="ja">{d.pattern || it.text}</b>
          </div>
        ) : (
          <div className={`square ${cls}`}>
            <SquareText text={it.text} />
          </div>
        )}
        <div className="stack" style={{ gap: 10 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{it.primary_meaning}</p>
          <div className="row">
            <KindTag kind={it.kind} />
            {it.word_type && <span className="tag">{it.word_type}</span>}
            {it.categories.map((c) => (
              <span key={c} className="tag">
                {c}
              </span>
            ))}
            {addingCat ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addCategory();
                }}
              >
                <input
                  type="text"
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  aria-label="New category"
                  placeholder="JLPT N4"
                  style={{ width: 160, padding: "4px 8px" }}
                  autoFocus
                />
                <button type="submit" className="chip">
                  Add
                </button>
                <button type="button" className="chip" onClick={() => setAddingCat(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="chip" aria-pressed={false} onClick={() => setAddingCat(true)}>
                Add category
              </button>
            )}
          </div>
          <div className="row">
            <StageMeter stage={it.stage} />
            <span className="dim small">
              {scheduleText(it)} ·{" "}
              {it.answers ? `${it.accuracy}% correct over ${it.answers} ${it.answers === 1 ? "answer" : "answers"}` : "No answers yet"}
            </span>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={onDrill} disabled={!it.reviewable || !drillReady}>
              Drill this card
            </button>
            <button type="button" className="btn quiet" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn danger" onClick={onDelete}>
              Delete
            </button>
            <span className="hint">Drilling does not change the schedule.</span>
          </div>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {!it.reviewable && (
        <div className="notice" role="note">
          Add an example sentence with the grammar part in [brackets] to review this entry.
        </div>
      )}

      <section className="section">
        <h2>Meaning</h2>
        <dl className="kv">
          <dt>Primary</dt>
          <dd>
            <b>{it.primary_meaning}</b>
          </dd>
          <dt>Alternatives</dt>
          <dd>
            {it.alt_meanings.length ? it.alt_meanings.join("; ") : <span className="dim">None</span>}{" "}
            <span className="dim small">({it.alt_meanings.length} of 5)</span>
          </dd>
          <dt>Your answers</dt>
          <dd>
            <span className="row" style={{ display: "inline-flex" }}>
              {it.user_synonyms.length > 0 && <span>{it.user_synonyms.join("; ")}</span>}
              {addingSyn ? (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addSynonym();
                  }}
                >
                  <input
                    type="text"
                    value={syn}
                    onChange={(e) => setSyn(e.target.value)}
                    aria-label="Accepted answer"
                    placeholder="to ask for"
                    style={{ width: 200, padding: "4px 8px" }}
                    autoFocus
                  />
                  <button type="submit" className="chip">
                    Add
                  </button>
                  <button type="button" className="chip" onClick={() => setAddingSyn(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button type="button" className="chip" aria-pressed={false} onClick={() => setAddingSyn(true)}>
                  Add accepted answer
                </button>
              )}
            </span>
          </dd>
        </dl>
        {it.kind === "vocabulary" && d.meaning_explanation && <Markdown>{d.meaning_explanation}</Markdown>}
      </section>

      {it.kind === "vocabulary" && (
        <section className="section">
          <h2>Reading</h2>
          <p style={{ margin: 0, fontSize: 22 }}>
            <span className="jp-text" lang="ja">
              {it.reading_kana}
            </span>{" "}
            <span className="dim" style={{ fontSize: 15 }}>
              {it.romaji}
            </span>
          </p>
          {d.reading_explanation && <Markdown>{d.reading_explanation}</Markdown>}
        </section>
      )}

      {it.kind === "kanji" && (
        <section className="section">
          <h2>Readings</h2>
          <dl className="kv">
            <dt>Onyomi</dt>
            <dd className="jp-text" lang="ja" style={{ fontSize: 18 }}>
              {d.onyomi?.length ? d.onyomi.join("、") : "—"}
            </dd>
            <dt>Kunyomi</dt>
            <dd className="jp-text" lang="ja" style={{ fontSize: 18 }}>
              {d.kunyomi?.length ? d.kunyomi.join("、") : "—"}
            </dd>
          </dl>
          {d.mnemonic && <Markdown>{d.mnemonic}</Markdown>}
        </section>
      )}

      {it.kind === "grammar" && (
        <>
          <section className="section">
            <h2>How it works</h2>
            {d.explanation_md ? (
              <Markdown>{d.explanation_md}</Markdown>
            ) : (
              <p className="dim" style={{ margin: 0 }}>No explanation written yet. Use Edit to add one.</p>
            )}
          </section>
          <section className="section">
            <h2>Examples</h2>
            {(d.examples ?? []).length === 0 && <p className="dim" style={{ margin: 0 }}>No examples yet. Use Edit to add some.</p>}
            {(d.examples ?? []).map((ex, i) => (
              <div key={i} className="sent">
                <span className="ja" lang="ja">
                  <MarkedSentence ja={ex.ja} />
                </span>
                {ex.translation && <span className="en">{ex.translation}</span>}
              </div>
            ))}
          </section>
        </>
      )}

      {it.kind === "vocabulary" && (patterns.length > 0 || sentences.length > 0) && (
        <section className="section">
          <h2>In context</h2>
          <div className="cols">
            {patterns.length > 0 && (
              <div className="stack" style={{ gap: 10 }}>
                <p className="eyebrow" style={{ margin: 0 }}>
                  Patterns
                </p>
                <div className="row">
                  {patterns.map((p) => (
                    <span key={p.pattern} className="tag" lang="ja">
                      {p.pattern}
                    </span>
                  ))}
                </div>
                {patterns.flatMap((p) =>
                  p.combinations.map((c, i) => (
                    <div key={`${p.pattern}-${i}`} className="sent">
                      <span className="ja" lang="ja">
                        {c.ja}
                      </span>
                      {c.en && <span className="en">{c.en}</span>}
                    </div>
                  )),
                )}
              </div>
            )}
            {sentences.length > 0 && (
              <div className="stack" style={{ gap: 10 }}>
                <p className="eyebrow" style={{ margin: 0 }}>
                  Sentences
                </p>
                {sentences.map((s, i) => (
                  <div key={i} className="sent">
                    <span className="ja" lang="ja">
                      {s.ja}
                    </span>
                    {s.en && <span className="en">{s.en}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {it.kind !== "grammar" && it.kanji_links.length > 0 && (
        <section className="section">
          <h2>{it.kind === "vocabulary" ? "Kanji in this word" : "Words with this kanji"}</h2>
          <div className="row">
            {it.kanji_links.map((k) => (
              <KanjiLink key={k.id} item={k} lang={lang} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Your note</h2>
        <textarea
          aria-label="Your note"
          placeholder="Anything that helps you remember this item"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteStatus(null);
          }}
          onBlur={() => void saveNote()}
        />
        <p className="hint" role="status" style={{ margin: 0 }}>
          {noteStatus ?? "Saved when you click outside the box."}
        </p>
        {it.source && <p className="hint" style={{ margin: 0 }}>Source: {it.source}</p>}
      </section>
    </>
  );
}

function KanjiLink({ item, lang }: { item: ItemSummary; lang: string }) {
  return (
    <Link className="kanji-link" href={`/${lang}/items/${item.id}`}>
      <b lang="ja">{item.text}</b>
      <span>{item.primary_meaning}</span>
      <span className="dim small" lang="ja">
        {item.reading_kana}
      </span>
    </Link>
  );
}
