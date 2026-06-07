/** Human-readable "time ago" from a Date / ISO string / epoch. */
export function timeAgo(input: string | number | Date | null | undefined): string {
  if (input === null || input === undefined) return '—';
  const ts =
    typeof input === 'number' ? (input < 1e12 ? input * 1000 : input) : new Date(input).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Short relative clock from start → now/end, e.g. "0:24" or "1:03:20". */
export function elapsed(startedAt: string | number | Date, endedAt?: string | number | Date | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  let s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Format a wall-clock time like "14:03:21". */
export function clockTime(input: string | number | Date | null | undefined): string {
  if (input === null || input === undefined) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format an integer with thousands separators. */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return n.toLocaleString();
}

/** Human byte sizes. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Truncate a long id / hash, keeping head and tail. */
export function shortId(id: string | null | undefined, head = 8, tail = 4): string {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
