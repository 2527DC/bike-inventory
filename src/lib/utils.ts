import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number): string {
  const val = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

export function formatTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Returns relative time string and aging level for accountability badges */
export function getAging(dateStr: string): { text: string; level: "ok" | "warning" | "danger" | "critical"; hours: number } {
  const ms = Date.now() - new Date(dateStr).getTime();
  const hours = ms / (1000 * 60 * 60);
  const days = Math.floor(hours / 24);

  let text: string;
  if (hours < 1) text = "Just now";
  else if (hours < 24) text = `${Math.floor(hours)}h ago`;
  else if (days === 1) text = "1 day ago";
  else text = `${days}d ago`;

  let level: "ok" | "warning" | "danger" | "critical";
  if (hours < 24) level = "ok";
  else if (hours < 48) level = "warning";
  else if (hours < 72) level = "danger";
  else level = "critical";

  return { text, level, hours };
}

export const AGING_COLORS = {
  ok: "",
  warning: "bg-yellow-50 border-yellow-200",
  danger: "bg-red-50 border-red-200",
  critical: "bg-red-100 border-red-300",
} as const;

export const AGING_BADGE = {
  ok: "",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900 animate-pulse",
} as const;

/** Edit distance between two strings (Levenshtein) — for typo tolerance */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Smart fuzzy search — matches substring, subsequence, or within edit distance tolerance */
export function fuzzyMatch(query: string, target: string | null | undefined): boolean {
  if (!target) return false;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return true;
  // Exact substring
  if (t.includes(q)) return true;
  // Check each word in target for close match
  const tWords = t.split(/[\s\-_\/]+/);
  const tolerance = q.length <= 3 ? 1 : q.length <= 6 ? 2 : 3;
  for (const w of tWords) {
    if (w.startsWith(q.slice(0, Math.max(1, q.length - 1)))) return true;
    if (editDistance(q, w) <= tolerance) return true;
    if (w.length > q.length && editDistance(q, w.slice(0, q.length)) <= 1) return true;
  }
  // Subsequence match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return true;
  return false;
}

/** Multi-field fuzzy search — returns true if ALL query words match at least one field */
export function fuzzySearchFields(query: string, fields: (string | null | undefined)[]): boolean {
  if (!query.trim()) return true;
  const words = query.trim().split(/\s+/);
  return words.every((word) => fields.some((f) => fuzzyMatch(word, f)));
}


/**
 * Message from an unknown caught value.
 *
 * Under `strict`, TypeScript types a catch binding as `unknown`, so `e.message` does not
 * compile — which is why the pattern here had been `catch (e: any)`. That annotation
 * silenced the compiler rather than answering the question, and a thrown string or object
 * would have produced `undefined` in the UI.
 *
 *     } catch (e) {
 *       setError(`Network error: ${errorMessage(e)}`);
 *     }
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}



export function extractYoutubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function formatXp(xp: number): string {
  if (xp >= 1000) return `${(xp / 1000).toFixed(1)}k`;
  return xp.toString();
}

export function getScenarioIcon(type: string): string {
  const icons: Record<string, string> = {
    'walk-in': 'door-open',
    'phone': 'phone',
    'repeat': 'refresh-cw',
    'festival': 'party-popper',
    'parent': 'baby',
    'comparison': 'scale',
    'service-upsell': 'wrench',
  };
  return icons[type] || 'clipboard';
}

export function getDifficultyColor(difficulty: string): string {
  switch (difficulty) {
    case 'beginner': return 'text-green-600 bg-green-50';
    case 'intermediate': return 'text-yellow-600 bg-yellow-50';
    case 'advanced': return 'text-red-600 bg-red-50';
    default: return 'text-gray-600 bg-gray-50';
  }
}
