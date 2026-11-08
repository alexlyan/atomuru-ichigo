"use client";

import { useId } from "react";
import { parseMarked } from "@/lib/format";
import type { ItemDetails, ItemOut, ItemPayload, Kind } from "@/lib/types";

export const MAX_ALTS = 5;

/** Flat, string-only form state for every kind; converted to the API payload on save. */
export interface FormState {
  kind: Kind;
  text: string;
  reading_kana: string;
  romaji: string;
  primary_meaning: string;
  alt_meanings: string;
  word_type: string;
  categories: string;
  meaning_explanation: string;
  reading_explanation: string;
  onyomi: string;
  kunyomi: string;
  mnemonic: string;
  pattern: string;
  explanation_md: string;
  examples: string;
}

export function emptyForm(kind: Kind): FormState {
  return {
    kind,
    text: "",
    reading_kana: "",
    romaji: "",
    primary_meaning: "",
    alt_meanings: "",
    word_type: "",
    categories: "",
    meaning_explanation: "",
    reading_explanation: "",
    onyomi: "",
    kunyomi: "",
    mnemonic: "",
    pattern: "",
    explanation_md: "",
    examples: "",
  };
}

export function formFromItem(item: ItemOut): FormState {
  const d = item.details;
  return {
    kind: item.kind,
    text: item.text,
    reading_kana: item.reading_kana,
    romaji: item.romaji,
    primary_meaning: item.primary_meaning,
    alt_meanings: item.alt_meanings.join("; "),
    word_type: item.word_type ?? "",
    categories: item.categories.join(", "),
    meaning_explanation: d.meaning_explanation ?? "",
    reading_explanation: d.reading_explanation ?? "",
    onyomi: (d.onyomi ?? []).join(", "),
    kunyomi: (d.kunyomi ?? []).join(", "),
    mnemonic: d.mnemonic ?? "",
    pattern: d.pattern ?? "",
    explanation_md: d.explanation_md ?? "",
    examples: (d.examples ?? []).map((e) => (e.translation ? `${e.ja} | ${e.translation}` : e.ja)).join("\n"),
  };
}

export function splitList(value: string, sep: RegExp | string): string[] {
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function parseExamples(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("|");
      return at < 0
        ? { ja: line, translation: "" }
        : { ja: line.slice(0, at).trim(), translation: line.slice(at + 1).trim() };
    });
}

/** Payload for POST /items or PATCH /items/{id}. `base` keeps detail fields this form does not edit. */
export function formToPayload(f: FormState, base: ItemDetails = {}): ItemPayload {
  const alts = splitList(f.alt_meanings, ";");
  const categories = splitList(f.categories, ",");
  const common = {
    kind: f.kind,
    text: f.text.trim(),
    primary_meaning: f.primary_meaning.trim(),
    alt_meanings: alts,
    categories,
  };
  if (f.kind === "vocabulary") {
    return {
      ...common,
      reading_kana: f.reading_kana.trim(),
      romaji: f.romaji.trim(),
      word_type: f.word_type || null,
      details: {
        ...base,
        meaning_explanation: f.meaning_explanation,
        reading_explanation: f.reading_explanation,
      },
    };
  }
  if (f.kind === "kanji") {
    const onyomi = splitList(f.onyomi, /[,、;]/);
    const kunyomi = splitList(f.kunyomi, /[,、;]/);
    const first = (kunyomi[0] ?? onyomi[0] ?? "").replace(/[.\-]/g, "");
    return {
      ...common,
      reading_kana: f.reading_kana || toHiragana(first),
      romaji: f.romaji,
      word_type: null,
      details: { ...base, onyomi, kunyomi, mnemonic: f.mnemonic },
    };
  }
  return {
    ...common,
    reading_kana: "",
    romaji: "",
    word_type: null,
    details: { ...base, pattern: f.pattern.trim(), explanation_md: f.explanation_md, examples: parseExamples(f.examples) },
  };
}

/** Problems that block saving. */
export function formErrors(f: FormState): string[] {
  const out: string[] = [];
  const name = f.kind === "kanji" ? "Character" : f.kind === "grammar" ? "Title" : "Japanese";
  if (!f.text.trim()) out.push(`${name} is empty.`);
  if (!f.primary_meaning.trim()) out.push(f.kind === "grammar" ? "Summary is empty." : "Primary meaning is empty.");
  const alts = splitList(f.alt_meanings, ";").length;
  if (alts > MAX_ALTS) out.push(`${alts} alternative meanings; the limit is ${MAX_ALTS}. Remove ${alts - MAX_ALTS}.`);
  if (f.kind === "vocabulary") {
    if (!f.reading_kana.trim()) out.push("Reading in kana is empty.");
    if (!f.romaji.trim()) out.push("Romaji is empty.");
  }
  if (f.kind === "kanji") {
    if ([...f.text.trim()].length > 1) out.push("Character must be a single kanji.");
    if (!splitList(f.onyomi, /[,、;]/).length && !splitList(f.kunyomi, /[,、;]/).length) {
      out.push("Give at least one reading, onyomi or kunyomi.");
    }
  }
  return out;
}

/** Things worth knowing that do not block saving. */
export function formWarnings(f: FormState): string[] {
  if (f.kind !== "grammar") return [];
  const examples = parseExamples(f.examples);
  const unmarked = examples.map((e, i) => (parseMarked(e.ja) ? null : i + 1)).filter((n): n is number => n !== null);
  const out: string[] = [];
  if (examples.length === 0 || unmarked.length === examples.length) {
    out.push("Add an example sentence with the grammar part in [brackets] to review this entry.");
  } else if (unmarked.length) {
    out.push(
      `Example ${unmarked.join(", ")} ${unmarked.length === 1 ? "has" : "have"} no single [marked] part, so ${unmarked.length === 1 ? "it is" : "they are"} not used in reviews.`,
    );
  }
  return out;
}

export function formIsBlank(f: FormState): boolean {
  const blank = emptyForm(f.kind);
  return (Object.keys(blank) as (keyof FormState)[]).every((k) => k === "kind" || f[k] === blank[k]);
}

export function ItemForm({
  value: f,
  onChange,
  wordTypes,
}: {
  value: FormState;
  onChange: (patch: Partial<FormState>) => void;
  wordTypes: string[];
}) {
  const id = useId();
  const field = (key: keyof FormState) => ({
    id: `${id}-${key}`,
    value: f[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ [key]: e.target.value } as Partial<FormState>),
  });
  const label = (key: keyof FormState, text: string) => <label htmlFor={`${id}-${key}`}>{text}</label>;
  const altCount = splitList(f.alt_meanings, ";").length;
  const altHint = (
    <div className={`hint counter${altCount > MAX_ALTS ? " over" : ""}`} aria-live="polite">
      Up to {MAX_ALTS}. {altCount} used.
    </div>
  );

  if (f.kind === "vocabulary") {
    return (
      <>
        <div className="fieldset">
          <div>
            {label("text", "Japanese")}
            <input type="text" lang="ja" {...field("text")} placeholder="求める" />
          </div>
          <div>
            {label("reading_kana", "Reading in kana")}
            <input type="text" lang="ja" {...field("reading_kana")} placeholder="もとめる" />
          </div>
          <div>
            {label("romaji", "Romaji")}
            <input type="text" {...field("romaji")} placeholder="motomeru" autoCapitalize="none" spellCheck={false} />
          </div>
          <div>
            {label("primary_meaning", "Primary meaning")}
            <input type="text" {...field("primary_meaning")} />
          </div>
          <div>
            {label("alt_meanings", "Alternative meanings")}
            <input type="text" {...field("alt_meanings")} placeholder="Separate with ;" />
            {altHint}
          </div>
          <div>
            {label("word_type", "Word type")}
            <select {...field("word_type")}>
              <option value="">Not set (counts as noun)</option>
              {wordTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            {label("categories", "Categories")}
            <input type="text" {...field("categories")} placeholder="transitive, ichidan, JLPT N4" />
            <div className="hint">Separate with commas.</div>
          </div>
        </div>
        <details>
          <summary className="dim" style={{ cursor: "pointer" }}>
            More: meaning explanation and reading mnemonic
          </summary>
          <div className="stack" style={{ marginTop: 14 }}>
            <div>
              {label("meaning_explanation", "Meaning explanation (Markdown)")}
              <textarea {...field("meaning_explanation")} />
            </div>
            <div>
              {label("reading_explanation", "Reading mnemonic (Markdown)")}
              <textarea {...field("reading_explanation")} />
            </div>
          </div>
        </details>
      </>
    );
  }

  if (f.kind === "kanji") {
    return (
      <>
        <div className="fieldset">
          <div>
            {label("text", "Character")}
            <input type="text" lang="ja" {...field("text")} placeholder="山" />
          </div>
          <div>
            {label("primary_meaning", "Meaning")}
            <input type="text" {...field("primary_meaning")} />
          </div>
          <div>
            {label("alt_meanings", "Other meanings")}
            <input type="text" {...field("alt_meanings")} placeholder="Separate with ;" />
            {altHint}
          </div>
          <div>
            {label("onyomi", "Onyomi")}
            <input type="text" lang="ja" {...field("onyomi")} placeholder="サン" />
            <div className="hint">Katakana, separate with commas.</div>
          </div>
          <div>
            {label("kunyomi", "Kunyomi")}
            <input type="text" lang="ja" {...field("kunyomi")} placeholder="やま, た.べる" />
            <div className="hint">Hiragana; a dot marks where okurigana starts.</div>
          </div>
          <div>
            {label("categories", "Categories")}
            <input type="text" {...field("categories")} placeholder="lesson 1, pictographs" />
          </div>
        </div>
        <div>
          {label("mnemonic", "Mnemonic (Markdown)")}
          <textarea {...field("mnemonic")} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fieldset">
        <div>
          {label("text", "Title")}
          <input type="text" lang="ja" {...field("text")} placeholder="〜に行きます" />
        </div>
        <div>
          {label("primary_meaning", "Summary")}
          <input type="text" {...field("primary_meaning")} placeholder="Going somewhere to do something" />
          <div className="hint">Accepted as the answer when you name the pattern.</div>
        </div>
        <div>
          {label("alt_meanings", "Other accepted summaries")}
          <input type="text" {...field("alt_meanings")} placeholder="Separate with ;" />
          {altHint}
        </div>
        <div>
          {label("pattern", "Pattern")}
          <input type="text" lang="ja" {...field("pattern")} placeholder="verb stem + に + 行きます" />
        </div>
        <div>
          {label("categories", "Categories")}
          <input type="text" {...field("categories")} placeholder="JLPT N5" />
        </div>
      </div>
      <div>
        {label("explanation_md", "Explanation (Markdown)")}
        <textarea {...field("explanation_md")} style={{ minHeight: 140 }} />
      </div>
      <div>
        {label("examples", "Examples")}
        <textarea {...field("examples")} lang="ja" placeholder={"コンビニへパンを[かいに]行きます。 | I'm going to the store to buy bread."} />
        <div className="hint">
          One per line: the Japanese sentence with the grammar part in [brackets], then | and the translation.
        </div>
      </div>
    </>
  );
}
