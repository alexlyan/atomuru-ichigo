"use client";

import { KIND_CLASS, stripMarks } from "@/lib/format";
import type { ItemOut } from "@/lib/types";
import { KindTag, SquareText } from "./bits";
import { Markdown } from "./Markdown";

/** The lesson card shown before drilling a new item. Buttons are passed in by the Learn page. */
export function LessonCard({ item, children }: { item: ItemOut; children: React.ReactNode }) {
  const d = item.details;
  const cls = KIND_CLASS[item.kind];
  const alts = item.alt_meanings.length ? `; ${item.alt_meanings.join("; ")}` : "";
  return (
    <div className="box stack">
      <div className="word">
        {item.kind === "grammar" ? (
          <div className={`square text ${cls}`}>
            <b lang="ja">{item.text}</b>
          </div>
        ) : (
          <div className={`square ${cls}`}>
            <SquareText text={item.text} />
          </div>
        )}
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <KindTag kind={item.kind} />
            {item.word_type && <span className="tag">{item.word_type}</span>}
            {item.categories.map((c) => (
              <span key={c} className="tag">
                {c}
              </span>
            ))}
            {item.stage === 0 && <span className="status info">started earlier</span>}
          </div>
          <dl className="kv">
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
            <dt>Meaning</dt>
            <dd>
              <b>{item.primary_meaning}</b>
              {alts}
            </dd>
            {item.kind === "kanji" && (
              <>
                <dt>Onyomi</dt>
                <dd className="jp-text" lang="ja">
                  {d.onyomi?.length ? d.onyomi.join("、") : "—"}
                </dd>
                <dt>Kunyomi</dt>
                <dd className="jp-text" lang="ja">
                  {d.kunyomi?.length ? d.kunyomi.join("、") : "—"}
                </dd>
              </>
            )}
            {item.kind === "grammar" && d.pattern && (
              <>
                <dt>Pattern</dt>
                <dd>{d.pattern}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {item.kind === "vocabulary" && d.meaning_explanation && <Markdown>{d.meaning_explanation}</Markdown>}
      {item.kind === "vocabulary" && d.reading_explanation && <Markdown>{d.reading_explanation}</Markdown>}
      {item.kind === "kanji" && d.mnemonic && <Markdown>{d.mnemonic}</Markdown>}
      {item.kind === "grammar" && d.explanation_md && <Markdown>{d.explanation_md}</Markdown>}
      {item.kind === "grammar" && (d.examples?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            Examples
          </p>
          {d.examples?.map((ex, i) => (
            <div key={i} className="sent">
              <span className="ja" lang="ja">
                {stripMarks(ex.ja)}
              </span>
              {ex.translation && <span className="en">{ex.translation}</span>}
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
