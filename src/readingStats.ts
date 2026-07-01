// Local, per-book reading intelligence — open counts, time spent, progress, and
// last-opened — persisted in localStorage so it survives reloads without a backend.

export interface BookStat {
  opens: number;
  secondsRead: number;
  lastOpenedAt: number; // epoch ms
  progress: number; // 0..1 scroll-through
}

type StatMap = Record<string, BookStat>;

const KEY = "bookform.reading-stats.v1";

function emptyStat(): BookStat {
  return { opens: 0, secondsRead: 0, lastOpenedAt: 0, progress: 0 };
}

export function loadStats(): StatMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StatMap) : {};
  } catch {
    return {};
  }
}

function persist(map: StatMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function getStat(map: StatMap, id: string): BookStat {
  return map[id] || emptyStat();
}

export function recordOpen(id: string): StatMap {
  const map = loadStats();
  const stat = getStat(map, id);
  map[id] = { ...stat, opens: stat.opens + 1, lastOpenedAt: Date.now() };
  persist(map);
  return map;
}

export function addSeconds(id: string, seconds: number): StatMap {
  if (!id || seconds <= 0) return loadStats();
  const map = loadStats();
  const stat = getStat(map, id);
  map[id] = { ...stat, secondsRead: stat.secondsRead + seconds, lastOpenedAt: Date.now() };
  persist(map);
  return map;
}

export function setProgress(id: string, progress: number): StatMap {
  const map = loadStats();
  const stat = getStat(map, id);
  const clamped = Math.max(0, Math.min(1, progress));
  // Only bump when meaningfully changed to avoid write churn.
  if (Math.abs(clamped - stat.progress) < 0.01) return map;
  map[id] = { ...stat, progress: clamped };
  persist(map);
  return map;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatRelative(epochMs: number): string {
  if (!epochMs) return "Never opened";
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
