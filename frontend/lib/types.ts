// Shapes returned by the FastAPI backend (backend/app/schemas.py and services/*.py).

export type Kind = "vocabulary" | "kanji" | "grammar";
export type Direction = "to_meaning" | "to_japanese";
export type SessionType = "learn" | "review" | "practice";
export type QuestionKind = "meaning" | "reading" | "cloze" | "name_pattern";

export interface WorkspaceInfo {
  language: string;
  name: string;
  native_name: string;
  direction: "ltr" | "rtl";
  due: number;
}

export interface AvailableLanguage {
  language: string;
  name: string;
  native_name: string;
  supported: boolean;
}

export interface Me {
  user: { id: string; email: string; name: string };
  active_language: string;
  workspaces: WorkspaceInfo[];
  total_due: number;
  available_languages: AvailableLanguage[];
  types: string[];
  word_types: string[];
}

export interface Settings {
  new_per_day: number;
  session_size: number;
  typo_tolerance: "strict" | "normal" | "forgiving";
  review_direction: "both" | "to_meaning" | "to_japanese";
  after_answer: "wait" | "advance_if_correct" | "always_advance";
  auto_advance_seconds: 1 | 2 | 4;
  skip_enabled: boolean;
  show_on_wrong: "answer_and_mine" | "answer_only";
  intervals_hours: Record<string, number>;
}

/** Keys: "not_started" (stage null), "0" (in lessons) and "1".."7". */
export type Distribution = Record<string, number>;

export interface Today {
  reviews_due: number;
  oldest_due_at: string | null;
  next_batch: { at: string; count: number } | null;
  new_available: number;
  in_lessons: number;
  learned_today: number;
  daily_cap: number;
  next_up: string[];
  streak_days: number;
  reviewed_today: number;
  accuracy_7d: number | null;
  total_items: number;
  forecast: { from_hours: number; count: number }[];
  distribution: Distribution;
}

export interface Pair {
  ja: string;
  en: string;
}

export interface VocabularyDetails {
  meaning_explanation?: string;
  reading_explanation?: string;
  patterns?: { pattern: string; combinations: Pair[] }[];
  sentences?: Pair[];
}

export interface KanjiDetails {
  onyomi?: string[];
  kunyomi?: string[];
  mnemonic?: string;
  lesson?: number | null;
}

export interface GrammarExample {
  ja: string;
  translation: string;
}

export interface GrammarDetails {
  pattern?: string;
  explanation_md?: string;
  examples?: GrammarExample[];
}

export type ItemDetails = VocabularyDetails & KanjiDetails & GrammarDetails & Record<string, unknown>;

export interface ItemSummary {
  id: string;
  kind: Kind;
  type: string;
  text: string;
  reading_kana: string;
  romaji: string;
  primary_meaning: string;
  stage: number | null;
  next_review_at: string | null;
  categories: string[];
  pattern: string;
}

export interface ItemOut extends ItemSummary {
  word_type: string | null;
  alt_meanings: string[];
  user_synonyms: string[];
  details: ItemDetails;
  note: string;
  source: string;
  created_at: string;
  answers: number;
  accuracy: number | null;
  kanji_links: ItemSummary[];
  reviewable: boolean;
  lesson_passes: number;
}

export interface ItemList {
  items: ItemSummary[];
  total: number;
  counts: { all: number; vocabulary: number; kanji: number; grammar: number };
}

export interface ItemPayload {
  kind?: Kind;
  text: string;
  reading_kana: string;
  romaji: string;
  primary_meaning: string;
  alt_meanings: string[];
  word_type: string | null;
  categories: string[];
  details: Record<string, unknown>;
}

export interface Question {
  item_id: string;
  kind: Kind;
  type: string;
  direction: Direction;
  question_kind: QuestionKind;
  prompt: { text: string; hint: string; highlight: string };
  stage: number | null;
  example_index: number | null;
}

export interface LessonState {
  passes: number;
  directions_done: Direction[];
  graduated: boolean;
}

export interface AnswerOut {
  event_id: number;
  correct: boolean;
  exact: boolean;
  note: string | null;
  expected: string[];
  your_answer: string;
  stage_before: number | null;
  stage_after: number | null;
  next_review_at: string | null;
  lesson: LessonState | null;
  can_accept: boolean;
}

export interface RegradeOut {
  correct: boolean;
  stage_before: number | null;
  stage_after: number | null;
  next_review_at: string | null;
  lesson: LessonState | null;
}

export interface AcceptOut {
  stage_after: number | null;
  next_review_at: string | null;
  added_synonym: string | null;
}

export interface LearnQueue {
  daily_cap: number;
  learned_today: number;
  waiting: number;
  cap_reached: boolean;
  in_progress: ItemOut[];
  new: ItemOut[];
}

export interface AccuracyRow {
  type: string;
  items: number;
  answers: number;
  review: number | null;
  to_meaning: number | null;
  to_japanese: number | null;
  practice: number | null;
}

export interface Progress {
  period_days: number | null;
  summary: { accuracy: number | null; answers: number; streak_days: number; mastered: number };
  by_type: AccuracyRow[];
  weakest: { type: string; review: number; direction: Direction | null; direction_accuracy: number | null } | null;
  distribution: Distribution;
}

export type RowStatus = "new" | "update" | "warning" | "error";

export interface ImportRow {
  row: number;
  status: RowStatus;
  messages: string[];
  data: (ItemPayload & { details?: KanjiDetails }) | null;
}

export interface ImportSummary {
  id: string;
  filename: string;
  kind: "vocabulary" | "kanji";
  status: "staged" | "committed" | "cancelled" | "undone";
  created_at: string;
  committed_at: string | null;
  counts: Record<RowStatus, number>;
  importable: number;
  expires_at: string | null;
  rows?: ImportRow[];
}
