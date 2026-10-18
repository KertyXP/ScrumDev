/**
 * Computes a deterministic 53-bit cyrb53 hash based on question title and sorted option texts.
 * Returns a hex string prefixed with 'q_'.
 *
 * Sorting option texts ensures that shuffled order does not change the hash.
 */
export function computeQuestionHash(title: string, options: { text: string }[]): string {
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');
  const normOptions = options
    .map((o) => o.text.trim().toLowerCase().replace(/\s+/g, ' '))
    .sort()
    .join('||');
  const combined = `${normTitle}:::${normOptions}`;

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hashNum = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return 'q_' + hashNum.toString(16).padStart(14, '0');
}

/**
 * Calculates the failure rate from a history of booleans.
 * true = success / correct, false = failure / incorrect.
 */
export function calculateFailureRate(history: boolean[]): number {
  if (!history || history.length === 0) return 0;
  const failureCount = history.filter((result) => !result).length;
  return failureCount / history.length;
}

/**
 * Checks whether a question was recently failed (failure rate > threshold).
 */
export function isRecentlyFailed(history: boolean[], threshold: number = 0.4): boolean {
  if (!history || history.length === 0) return false;
  return calculateFailureRate(history) > threshold;
}
