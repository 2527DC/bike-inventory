/**
 * Wrapper around fetch that throws on non-OK responses.
 * All client components must use this instead of raw fetch for mutations.
 */
export async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res;
}
