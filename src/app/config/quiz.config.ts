export const QUIZ_CONFIG = {
  /**
   * Frequency of presenting a recently failed question (e.g. 1 out of every 5 questions).
   */
  FAILED_RETRY_INTERVAL: 5,

  /**
   * Threshold for failure rate (> 40% failures in the last 5 attempts) to qualify for replay.
   */
  FAILURE_RATE_THRESHOLD: 0.4,

  /**
   * Maximum history count per question stored in localStorage.
   */
  MAX_HISTORY_ENTRIES: 5,

  /**
   * LocalStorage key storing the list of recorded question hashes.
   */
  STORAGE_INDEX_KEY: 'scrumdev_memory_hashes',

  /**
   * LocalStorage key storing overall cumulative stats (answered count, correct count).
   */
  STORAGE_STATS_KEY: 'scrumdev_overall_stats',
};
