"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { KindTag, StageMeter } from "@/components/bits";
import { ErrorBox, Loading, Page } from "@/components/Page";
import { useApi, wsPath } from "@/lib/api";
import { typeLabel } from "@/lib/format";
import type { ItemList, ItemSummary } from "@/lib/types";

const TABS = [
  { value: "all", label: "All" },
  { value: "vocabulary", label: "Vocabulary" },
  { value: "kanji", label: "Kanji" },
  { value: "grammar", label: "Grammar" },
] as const;
const STAGES = [
  { value: "", label: "Any stage" },
  { value: "new", label: "New" },
  { value: "0", label: "In lessons" },
  { value: "1,2,3", label: "Stages 1 to 3" },
  { value: "4,5,6", label: "Stages 4 to 6" },
  { value: "7", label: "Mastered" },
];
const SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "next_review", label: "Next review" },
  { value: "most_missed", label: "Most missed" },
  { value: "az", label: "A to Z" },
];
const PAGE = 100;
const NOUN: Record<string, string> = { all: "items", vocabulary: "words", kanji: "kanji", grammar: "grammar entries" };

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const { lang } = useParams<{ lang: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me, workspace } = useApp();

  const tab = oneOf(search.get("tab"), TABS.map((t) => t.value), "all");
  const q = search.get("q") ?? "";
  const types = search.get("types") ?? "";
  const stages = search.get("stages") ?? "";
  const sort = oneOf(search.get("sort"), SORTS.map((s) => s.value), "recent");
  const [text, setText] = useState(q);
  const [limit, setLimit] = useState(PAGE);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const p = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [search, router, pathname],
  );

  // Search box writes to the URL after a short pause.
  useEffect(() => {
    if (text.trim() === q) return;
    const t = window.setTimeout(() => setParams({ q: text.trim() }), 300);
    return () => window.clearTimeout(t);
  }, [text, q, setParams]);

  const query = new URLSearchParams({ tab, sort, limit: String(limit) });
  if (q) query.set("q", q);
  if (types) query.set("types", types);
  if (stages) query.set("stages", stages);
  const list = useApi<ItemList>(wsPath(lang, `/items?${query}`));
  const data = list.data;
  const filtered = Boolean(q || types || stages);

  return (
    <Page title="Library" eyebrow={`Everything you have added${workspace ? ` in ${workspace.name}` : ""}`}>
      <div className="tabs" role="tablist" aria-label="Item kind">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={tab === t.value ? "on" : undefined}
            onClick={() => setParams({ tab: t.value === "all" ? "" : t.value })}
          >
            {t.label} <span className="mono dim">{data ? data.counts[t.value] : ""}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search Japanese, romaji or meaning"
          aria-label="Search"
        />
        <select aria-label="Type" value={types} onChange={(e) => setParams({ types: e.target.value })}>
          <option value="">Any type</option>
          {(me?.types ?? []).map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
        <select aria-label="Stage" value={stages} onChange={(e) => setParams({ stages: e.target.value })}>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setParams({ sort: e.target.value === "recent" ? "" : e.target.value })}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {data && (
        <div className="between result-count" role="status">
          <span>
            <b className="mono">{data.total}</b>{" "}
            {filtered ? (
              <span className="dim">
                of {data.counts[tab]} {NOUN[tab]} match
              </span>
            ) : (
              <span className="dim">{NOUN[tab]}</span>
            )}
          </span>
          {filtered && (
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                setText("");
                setParams({ q: "", types: "", stages: "" });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {list.error && <ErrorBox message={list.error.message} onRetry={list.reload} />}
      {!data && list.loading && <Loading />}
      {data && data.items.length === 0 && (
        <div className="box stack">
          {data.counts.all === 0 ? (
            <>
              <h2>Your library is empty.</h2>
              <p className="dim" style={{ margin: 0 }}>
                Add words, kanji or grammar one at a time, or import a CSV file.
              </p>
              <div className="row">
                <Link className="btn" href={`/${lang}/add`}>
                  Add items
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Nothing matches.</h2>
              <p className="dim" style={{ margin: 0 }}>
                {filtered ? "Change the search or the filters to see more." : "This tab has no items yet."}
              </p>
              {filtered && (
                <div className="row">
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => {
                      setText("");
                      setParams({ q: "", types: "", stages: "" });
                    }}
                  >
                    Clear search and filters
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="stack" style={{ opacity: list.loading ? 0.6 : 1 }}>
          {tab === "all" && <MixedTable items={data.items} lang={lang} />}
          {tab === "vocabulary" && <VocabTable items={data.items} lang={lang} />}
          {tab === "kanji" && <KanjiGrid items={data.items} lang={lang} />}
          {tab === "grammar" && <GrammarList items={data.items} lang={lang} />}
          {data.total > data.items.length && (
            <div className="row">
              {limit < 500 ? (
                <button type="button" className="btn quiet load-more" onClick={() => setLimit((l) => Math.min(l + PAGE, 500))}>
                  Show more ({data.total - data.items.length} not shown)
                </button>
              ) : (
                <span className="hint">
                  Showing the first {data.items.length} of {data.total}. Search or filter to find the rest.
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <p className="hint">Rows open the item&apos;s card. Filters and search apply to the selected tab.</p>
    </Page>
  );
}

function MixedTable({ items, lang }: { items: ItemSummary[]; lang: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Meaning</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link href={`/${lang}/items/${i.id}`} className="jp-text" lang="ja">
                  {i.text}
                </Link>
              </td>
              <td>
                <KindTag kind={i.kind} />
              </td>
              <td>{i.primary_meaning}</td>
              <td>
                <StageMeter stage={i.stage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VocabTable({ items, lang }: { items: ItemSummary[]; lang: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Word</th>
            <th>Romaji</th>
            <th>Meaning</th>
            <th>Word type</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link href={`/${lang}/items/${i.id}`} className="jp-text" lang="ja">
                  {i.text}
                </Link>
              </td>
              <td>{i.romaji}</td>
              <td>{i.primary_meaning}</td>
              <td>
                <span className="tag">{i.type}</span>
              </td>
              <td>
                <StageMeter stage={i.stage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KanjiGrid({ items, lang }: { items: ItemSummary[]; lang: string }) {
  return (
    <div className="kgrid">
      {items.map((i) => (
        <Link
          key={i.id}
          href={`/${lang}/items/${i.id}`}
          title={i.stage === null ? "Not started" : `Stage ${i.stage} of 7`}
        >
          <b lang="ja">{i.text}</b>
          <small>{i.primary_meaning}</small>
        </Link>
      ))}
    </div>
  );
}

function GrammarList({ items, lang }: { items: ItemSummary[]; lang: string }) {
  return (
    <div className="glist">
      {items.map((i) => (
        <Link key={i.id} href={`/${lang}/items/${i.id}`}>
          <span className="pat" lang="ja">
            {i.text}
          </span>
          <span>
            <b>{i.primary_meaning}</b>
            {i.pattern && (
              <>
                <br />
                <span className="dim small">{i.pattern}</span>
              </>
            )}
          </span>
          <StageMeter stage={i.stage} />
        </Link>
      ))}
    </div>
  );
}
