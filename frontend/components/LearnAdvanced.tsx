"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { api, errorText, useApi, wsPath } from "@/lib/api";
import type { ItemList } from "@/lib/types";

export interface Category {
  name: string;
  count: number;
}

/**
 * Learn > Advanced: limit lessons to some categories (lesson labels, topics) and pick
 * specific items to learn first. Picked items move to the front of the queue and stay there.
 */
export function LearnAdvanced({
  lang,
  types,
  categories,
  onCategories,
  onPrioritized,
}: {
  lang: string;
  types: string[];
  categories: string[];
  onCategories: (next: string[]) => void;
  onPrioritized: () => void;
}) {
  const [open, setOpen] = useState(categories.length > 0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catLabel = useId();
  const searchId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const cats = useApi<Category[]>(open ? wsPath(lang, "/categories?stages=new") : null);

  const listUrl = useMemo(() => {
    if (!open) return null;
    const p = new URLSearchParams({ stages: "new", sort: "queue", limit: "200" });
    if (types.length) p.set("types", types.join(","));
    if (categories.length) p.set("categories", categories.join("|"));
    if (debounced.trim()) p.set("q", debounced.trim());
    return wsPath(lang, `/items?${p.toString()}`);
  }, [open, lang, types, categories, debounced]);
  const list = useApi<ItemList>(listUrl);

  const toggleCat = (name: string) =>
    onCategories(categories.includes(name) ? categories.filter((c) => c !== name) : [...categories, name]);
  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const moveToFront = async () => {
    if (!picked.length) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api<{ moved: number }>(wsPath(lang, "/learn/prioritize"), {
        method: "POST",
        json: { item_ids: picked },
      });
      setStatus(res.moved === 1 ? "1 item is now first in your lessons." : `${res.moved} items are now first in your lessons.`);
      setPicked([]);
      list.reload();
      onPrioritized();
    } catch (e) {
      setStatus(`Could not reorder: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <button type="button" className="btn quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide advanced" : "Advanced: choose what to learn first"}
        </button>
      </div>

      {open && (
        <div className="box stack advanced">
          <div>
            <label id={catLabel}>
              Lessons and topics <span className="dim" style={{ fontWeight: 400 }}>only items still waiting are counted</span>
            </label>
            {cats.loading && !cats.data && <p className="hint">Loading categories…</p>}
            {cats.error && <p className="hint">Could not load categories: {cats.error.message}</p>}
            <div className="chips" role="group" aria-labelledby={catLabel}>
              <button type="button" className="chip" aria-pressed={categories.length === 0} onClick={() => onCategories([])}>
                All
              </button>
              {(cats.data ?? []).map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className="chip"
                  aria-pressed={categories.includes(c.name)}
                  onClick={() => toggleCat(c.name)}
                >
                  {c.name} <span className="mono dim">{c.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="between">
              <label htmlFor={searchId} style={{ margin: 0 }}>
                Pick items to learn first
              </label>
              <span className="dim small">
                {list.data ? `${list.data.total} waiting${list.data.total > list.data.items.length ? `, first ${list.data.items.length} shown` : ""}` : ""}
              </span>
            </div>
            <input
              id={searchId}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Japanese, romaji or meaning"
            />
            <div className="pick-list" role="group" aria-label="Items waiting to be learned">
              {list.error && <p className="hint">Could not load items: {list.error.message}</p>}
              {list.data && list.data.items.length === 0 && <p className="hint">Nothing waiting matches these filters.</p>}
              {(list.data?.items ?? []).map((it) => (
                <label key={it.id} className="pick-row">
                  <input type="checkbox" checked={picked.includes(it.id)} onChange={() => togglePick(it.id)} />
                  <span className="jp-text" lang="ja">
                    {it.kind === "grammar" ? it.pattern || it.text : it.text}
                  </span>
                  <span className="dim small">{it.kind === "vocabulary" ? it.romaji : it.type}</span>
                  <span className="small pick-meaning">{it.primary_meaning}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn" disabled={!picked.length || busy} onClick={() => void moveToFront()}>
                {busy ? "Moving…" : picked.length ? `Learn these ${picked.length} first` : "Learn selected first"}
              </button>
              {picked.length > 0 && (
                <button type="button" className="btn quiet" onClick={() => setPicked([])}>
                  Clear selection
                </button>
              )}
              {status && (
                <span className="small" role="status">
                  {status}
                </span>
              )}
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Picked items move to the front of your lesson queue in the order you picked them. The daily limit still applies.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
