import type { Kind } from "./types";

export const KIND_LABEL: Record<Kind, string> = { vocabulary: "Vocabulary", kanji: "Kanji", grammar: "Grammar" };
export const KIND_CLASS: Record<Kind, string> = { vocabulary: "vocab", kanji: "kanji", grammar: "grammar" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "14 days", "12 hours", "25 minutes". */
export function duration(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs >= 2 * DAY) return plural(Math.round(abs / DAY), "day");
  if (abs >= HOUR) return plural(Math.round(abs / HOUR), "hour");
  return plural(Math.max(1, Math.round(abs / 60_000)), "minute");
}

/** "in 14 days", or "now" when the moment has passed. */
export function inTime(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 30_000) return "now";
  return `in ${duration(ms)}`;
}

export function ago(iso: string | null): string {
  if (!iso) return "";
  return duration(Date.now() - new Date(iso).getTime());
}

/** 24-hour clock in the browser's zone: "18:00". */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "at 18:00", "tomorrow at 09:00" or "on 12 Nov at 09:00". */
export function whenAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / DAY);
  if (diff <= 0) return `at ${clock(iso)}`;
  if (diff === 1) return `tomorrow at ${clock(iso)}`;
  return `on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${clock(iso)}`;
}

export function longDate(d = new Date()): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function hoursLabel(h: number): string {
  if (h % 24 === 0) return plural(h / 24, "day");
  return plural(h, "hour");
}

export function pct(n: number | null): string {
  return n === null ? "no data" : `${n}%`;
}

/** Type names as a group: "i-adjectives", "kanji", "grammar entries". */
export function typePlural(type: string): string {
  if (type === "kanji") return "kanji";
  if (type === "grammar") return "grammar entries";
  if (type === "question-word") return "question words";
  return `${type}s`;
}

export const DIRECTION_LABEL: Record<string, string> = {
  to_meaning: "Japanese to meaning",
  to_japanese: "meaning to Japanese",
};

/** A grammar example "コンビニへパンを[かいに]行きます。" split into its parts. */
export function parseMarked(sentence: string): { before: string; target: string; after: string } | null {
  const marks = [...sentence.matchAll(/\[([^[\]]+)\]/g)];
  if (marks.length !== 1) return null;
  const m = marks[0];
  const start = m.index ?? 0;
  return { before: sentence.slice(0, start), target: m[1].trim(), after: sentence.slice(start + m[0].length) };
}

export function stripMarks(sentence: string): string {
  return sentence.replace(/[[\]]/g, "");
}

export const STAGE_KEYS = ["new", "1", "2", "3", "4", "5", "6", "7"] as const;
