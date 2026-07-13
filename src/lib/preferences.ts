// Reader preferences, persisted in localStorage: one global set plus optional
// per-book overrides (theme, font, and the resume position).

import { DEFAULT_FONT_ID } from "./fonts";

export type WidthMode = "narrow" | "standard" | "wide";
export type PageTheme = "white" | "paper" | "sepia" | "grey" | "night" | "focus";
export type AppTheme = "light" | "dark";
export type ViewMode = "reader" | "original";

export interface ResumePoint {
  sectionId?: string;
  paraIndex?: number;
  ratio: number;
}

export interface GlobalPrefs {
  fontId: string;
  fontSize: number;
  widthMode: WidthMode;
  pageTheme: PageTheme;
  appTheme: AppTheme;
  railOpen: boolean;
}

export interface BookPrefs extends Partial<GlobalPrefs> {
  viewMode?: ViewMode;
  resume?: ResumePoint;
}

export interface Prefs {
  global: GlobalPrefs;
  perBook: Record<string, BookPrefs>;
}

const KEY = "quire.prefs.v1";

export const DEFAULT_GLOBAL_PREFS: GlobalPrefs = {
  fontId: DEFAULT_FONT_ID,
  fontSize: 19,
  widthMode: "standard",
  pageTheme: "white",
  appTheme: "light",
  railOpen: true
};

let cache: Prefs | null = null;
let writeTimer: number | undefined;

export function loadPrefs(): Prefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    cache = {
      global: { ...DEFAULT_GLOBAL_PREFS, ...parsed.global },
      perBook: parsed.perBook || {}
    };
  } catch {
    cache = { global: { ...DEFAULT_GLOBAL_PREFS }, perBook: {} };
  }
  return cache;
}

export function updateGlobalPrefs(patch: Partial<GlobalPrefs>): Prefs {
  const prefs = loadPrefs();
  cache = { ...prefs, global: { ...prefs.global, ...patch } };
  schedulePersist();
  return cache;
}

export function updateBookPrefs(bookId: string, patch: BookPrefs): Prefs {
  const prefs = loadPrefs();
  const existing = prefs.perBook[bookId] || {};
  cache = { ...prefs, perBook: { ...prefs.perBook, [bookId]: { ...existing, ...patch } } };
  schedulePersist();
  return cache;
}

export function removeBookPrefs(bookId: string): void {
  const prefs = loadPrefs();
  if (!(bookId in prefs.perBook)) return;
  const perBook = { ...prefs.perBook };
  delete perBook[bookId];
  cache = { ...prefs, perBook };
  schedulePersist();
}

/** Global preferences with any per-book overrides applied. */
export function resolveForBook(bookId: string | undefined): GlobalPrefs & BookPrefs {
  const prefs = loadPrefs();
  const overrides = bookId ? prefs.perBook[bookId] || {} : {};
  return { ...prefs.global, ...stripUndefined(overrides) };
}

function stripUndefined<T extends object>(value: T): T {
  const output = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(output)) {
    if (output[key] === undefined) delete output[key];
  }
  return output as T;
}

function schedulePersist() {
  if (writeTimer !== undefined) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = undefined;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* storage full or unavailable — ignore */
    }
  }, 300);
}
