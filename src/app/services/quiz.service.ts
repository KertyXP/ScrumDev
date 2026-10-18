import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  ActiveQuestionItem,
  Question,
  QuestionOption,
  QuestionMemoryRecord,
  QuizMemoryStats,
  SessionStats,
} from '../models/quiz.model';
import { QUIZ_CONFIG } from '../config/quiz.config';
import {
  calculateFailureRate,
  computeQuestionHash,
  isRecentlyFailed,
} from '../utils/hash.util';

export function parseMarkdownQuestions(markdown: string): Question[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const questions: Question[] = [];

  let currentTitle: string | null = null;
  let currentOptions: QuestionOption[] = [];
  let optionCounter = 0;

  const flush = () => {
    if (currentTitle && currentOptions.length > 0) {
      const title = currentTitle.trim();
      let instruction: string | undefined;

      const parenMatch = title.match(/\((choose[^)]+)\)/i);
      if (parenMatch) {
        const rawInstruction = parenMatch[1].trim();
        // Ignore generic "choose the best answer"
        if (!/^choose\s+(the\s+)?best\s+answer$/i.test(rawInstruction)) {
          instruction = rawInstruction;
        }
      }

      const correctCount = currentOptions.filter((o) => o.isCorrect).length;
      const isMultipleChoice = correctCount > 1;

      // Compute deterministic hash from question title and options
      const hash = computeQuestionHash(title, currentOptions);

      questions.push({
        id: questions.length + 1,
        hash,
        title,
        instruction,
        options: [...currentOptions],
        isMultipleChoice,
        expectedCorrectCount: correctCount,
      });
    }
    currentTitle = null;
    currentOptions = [];
    optionCounter = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check for header line: ### Question
    const headerMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headerMatch) {
      flush();
      currentTitle = headerMatch[1].trim();
      continue;
    }

    // Check for option item: - [x] Text or - [ ] Text
    const optionMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (optionMatch && currentTitle) {
      optionCounter++;
      const isCorrect = optionMatch[1].toLowerCase() === 'x';
      const text = optionMatch[2].trim();
      currentOptions.push({
        id: `opt_${questions.length + 1}_${optionCounter}`,
        text,
        isCorrect,
      });
    }
  }

  flush();
  return questions;
}

@Injectable({
  providedIn: 'root',
})
export class QuizService {
  private readonly http = inject(HttpClient);

  readonly rawMarkdown = signal<string>('');
  readonly allQuestions = signal<Question[]>([]);

  // Local storage memory map indexed by question hash
  readonly questionMemoryMap = signal<Map<string, QuestionMemoryRecord>>(new Map());

  // Active question at the top
  readonly activeItem = signal<ActiveQuestionItem | null>(null);

  // Previously answered questions below
  readonly history = signal<ActiveQuestionItem[]>([]);
  readonly showHistory = signal<boolean>(true);

  // Retry mode (practice only failed questions)
  readonly isRetryMode = signal<boolean>(false);

  // Persistent Overall Stats from localStorage
  private readonly initialStats = this.loadStoredStats();
  readonly answeredCount = signal<number>(this.initialStats.answeredCount);
  readonly correctCount = signal<number>(this.initialStats.correctCount);

  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  private lastQuestionId: number | null = null;
  private sessionCounter = 0;
  private examQuestionCounter = 0;

  // Global rating computation in %
  readonly ratingPercentage = computed<number>(() => {
    const answered = this.answeredCount();
    if (answered === 0) return 100;
    return Math.round((this.correctCount() / answered) * 100);
  });

  readonly sessionStats = computed<SessionStats>(() => {
    const answered = this.answeredCount();
    const correct = this.correctCount();
    const incorrect = answered - correct;
    const rating = answered === 0 ? 100 : Math.round((correct / answered) * 100);

    return {
      answeredCount: answered,
      correctCount: correct,
      incorrectCount: incorrect,
      ratingPercentage: rating,
    };
  });

  // Memory stats across all questions
  readonly memoryStats = computed<QuizMemoryStats>(() => {
    const all = this.allQuestions();
    const memMap = this.questionMemoryMap();

    let excludedCount = 0;
    let unansweredCount = 0;
    let recentlyFailedCount = 0;
    let masteredCount = 0;

    for (const q of all) {
      const mem = memMap.get(q.hash);
      if (mem?.neverAskAgain) {
        excludedCount++;
      } else if (!mem || mem.history.length === 0) {
        unansweredCount++;
      } else if (isRecentlyFailed(mem.history, QUIZ_CONFIG.FAILURE_RATE_THRESHOLD)) {
        recentlyFailedCount++;
      } else {
        masteredCount++;
      }
    }

    return {
      totalQuestions: all.length,
      unansweredCount,
      recentlyFailedCount,
      masteredCount,
      excludedCount,
    };
  });

  readonly failedCount = computed<number>(() => this.memoryStats().recentlyFailedCount);

  constructor() {
    this.loadDefaultQuestions();
  }

  private loadStoredStats(): { answeredCount: number; correctCount: number } {
    try {
      const raw = localStorage.getItem(QUIZ_CONFIG.STORAGE_STATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.answeredCount === 'number' && typeof parsed.correctCount === 'number') {
          return {
            answeredCount: parsed.answeredCount,
            correctCount: parsed.correctCount,
          };
        }
      }
    } catch {}
    return { answeredCount: 0, correctCount: 0 };
  }

  private saveStoredStats(stats: { answeredCount: number; correctCount: number }): void {
    try {
      localStorage.setItem(QUIZ_CONFIG.STORAGE_STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      console.warn('Could not save stats to localStorage:', e);
    }
  }

  private loadAllFromLocalStorage(questions: Question[]): Map<string, QuestionMemoryRecord> {
    const map = new Map<string, QuestionMemoryRecord>();

    // 1. Load by index if available
    let storedHashes: string[] = [];
    try {
      const indexRaw = localStorage.getItem(QUIZ_CONFIG.STORAGE_INDEX_KEY);
      if (indexRaw) {
        storedHashes = JSON.parse(indexRaw);
      }
    } catch {}

    // Combine indexed hashes with current question hashes
    const allHashes = new Set([...storedHashes, ...questions.map((q) => q.hash)]);

    for (const hash of allHashes) {
      try {
        const raw = localStorage.getItem(hash);
        if (raw) {
          const record: QuestionMemoryRecord = JSON.parse(raw);
          if (record && record.hash) {
            map.set(record.hash, record);
          }
        }
      } catch {}
    }

    return map;
  }

  saveMemoryRecord(record: QuestionMemoryRecord): void {
    try {
      // 1. Store under key = hash
      localStorage.setItem(record.hash, JSON.stringify(record));

      // 2. Update hash index
      const indexRaw = localStorage.getItem(QUIZ_CONFIG.STORAGE_INDEX_KEY);
      const hashes: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      if (!hashes.includes(record.hash)) {
        hashes.push(record.hash);
        localStorage.setItem(QUIZ_CONFIG.STORAGE_INDEX_KEY, JSON.stringify(hashes));
      }
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }

    // Update in-memory signal map
    this.questionMemoryMap.update((prev) => {
      const next = new Map(prev);
      next.set(record.hash, record);
      return next;
    });
  }

  getMemoryRecord(hash: string): QuestionMemoryRecord | undefined {
    return this.questionMemoryMap().get(hash);
  }

  // --- Question Selection Logic ---

  /**
   * Selection strategy:
   * 1. Exclude questions marked as `neverAskAgain`.
   * 2. In retry mode: pick from recently failed questions (> 40% failures).
   * 3. In normal exam mode:
   *    - Every FAILED_RETRY_INTERVAL questions (e.g. 1 out of 5), pick a recently failed question (> 40% failures).
   *    - Otherwise, pick in priority from UNANSWERED questions.
   *    - If all questions are answered, pick from recently failed questions.
   *    - If no questions are failing, cycle through all eligible questions.
   */
  private getNextQuestion(): { question: Question; reason: ActiveQuestionItem['servedReason'] } | null {
    const all = this.allQuestions();
    if (all.length === 0) return null;

    const memMap = this.questionMemoryMap();

    // 1. Eligible questions (exclude questions where user checked "never ask again")
    const eligible = all.filter((q) => {
      const mem = memMap.get(q.hash);
      return !mem?.neverAskAgain;
    });

    if (eligible.length === 0) {
      return null;
    }

    // Identify recently failed questions (> 40% failure rate)
    const recentlyFailed = eligible.filter((q) => {
      const mem = memMap.get(q.hash);
      return mem && mem.history.length > 0 && isRecentlyFailed(mem.history, QUIZ_CONFIG.FAILURE_RATE_THRESHOLD);
    });

    // Practice / Retry Mode
    if (this.isRetryMode()) {
      if (recentlyFailed.length > 0) {
        return {
          question: this.pickRandom(recentlyFailed),
          reason: 'retry_mode',
        };
      } else {
        // All failed questions are resolved
        this.isRetryMode.set(false);
      }
    }

    // Questions not yet answered by the user
    const unanswered = eligible.filter((q) => {
      const mem = memMap.get(q.hash);
      return !mem || mem.history.length === 0;
    });

    this.examQuestionCounter++;

    // "de temps en temps (1 fois sur 5 ? constante à mettre en config), on lui fait repasser une question qu'il a échoué récemment (> 40% d'échecs sur la question --> à rejouer)"
    const isRetrySlot =
      this.examQuestionCounter > 1 &&
      this.examQuestionCounter % QUIZ_CONFIG.FAILED_RETRY_INTERVAL === 0;

    if (isRetrySlot && recentlyFailed.length > 0) {
      return {
        question: this.pickRandom(recentlyFailed),
        reason: 'retry_failed',
      };
    }

    // "il pioche en priorité les questions auxquels l'user n'a pas encore répondu"
    if (unanswered.length > 0) {
      return {
        question: this.pickRandom(unanswered),
        reason: 'unanswered',
      };
    }

    // If all questions have already been answered at least once:
    // Priority to questions with > 40% failure
    if (recentlyFailed.length > 0) {
      return {
        question: this.pickRandom(recentlyFailed),
        reason: 'retry_failed',
      };
    }

    // Otherwise, cycle through eligible questions
    return {
      question: this.pickRandom(eligible),
      reason: 'cycle',
    };
  }

  private pickRandom(candidates: Question[]): Question {
    if (candidates.length === 1) return candidates[0];

    // Avoid repeating the same question immediately if pool > 1
    const different = candidates.filter((q) => q.id !== this.lastQuestionId);
    const pool = different.length > 0 ? different : candidates;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Quiz Progression ---

  loadDefaultQuestions(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.http.get('questions.md', { responseType: 'text' }).subscribe({
      next: (markdown) => {
        this.rawMarkdown.set(markdown);
        this.initQuestions(markdown);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.warn('Could not load questions.md via HTTP, trying fetch:', err);
        fetch('questions.md')
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            return res.text();
          })
          .then((text) => {
            this.rawMarkdown.set(text);
            this.initQuestions(text);
            this.isLoading.set(false);
          })
          .catch(() => {
            this.errorMessage.set(
              'Unable to load questions.md file. You can import your own Markdown below.',
            );
            this.isLoading.set(false);
          });
      },
    });
  }

  initQuestions(markdown: string): void {
    const parsed = parseMarkdownQuestions(markdown);
    this.allQuestions.set(parsed);

    // Load local storage memory
    const memory = this.loadAllFromLocalStorage(parsed);
    this.questionMemoryMap.set(memory);

    // Start a clean question stream and empty history without wiping overall stats
    this.resetQuestionStream();

    if (parsed.length === 0) {
      this.errorMessage.set('No valid questions found in the Markdown file.');
    } else {
      this.errorMessage.set(null);
    }
  }

  resetQuestionStream(): void {
    this.lastQuestionId = null;
    this.sessionCounter = 0;
    this.examQuestionCounter = 0;
    this.history.set([]);
    this.activeItem.set(null);
    this.isRetryMode.set(false);

    if (this.allQuestions().length > 0) {
      this.loadNextQuestionAtTop();
    }
  }

  resetSession(clearStats: boolean = true): void {
    if (clearStats) {
      this.answeredCount.set(0);
      this.correctCount.set(0);
      this.saveStoredStats({ answeredCount: 0, correctCount: 0 });
    }
    this.resetQuestionStream();
  }

  loadNextQuestionAtTop(): void {
    const result = this.getNextQuestion();
    if (!result) {
      this.activeItem.set(null);
      return;
    }

    const { question: nextQ, reason } = result;
    this.lastQuestionId = nextQ.id;
    this.sessionCounter++;

    const mem = this.questionMemoryMap().get(nextQ.hash);

    const newItem: ActiveQuestionItem = {
      streamId: `q_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      question: {
        ...nextQ,
        options: this.shuffleArray(nextQ.options),
      },
      selectedOptionIds: [],
      isConfirmed: false,
      isFullyCorrect: null,
      questionNumber: this.sessionCounter,
      isExcluded: mem?.neverAskAgain ?? false,
      memoryHistory: mem?.history ? [...mem.history] : [],
      servedReason: reason,
    };

    this.activeItem.set(newItem);
  }

  toggleOption(optionId: string): void {
    const current = this.activeItem();
    if (!current || current.isConfirmed) return;

    let newSelected: string[];
    if (current.question.isMultipleChoice) {
      if (current.selectedOptionIds.includes(optionId)) {
        newSelected = current.selectedOptionIds.filter((id) => id !== optionId);
      } else {
        newSelected = [...current.selectedOptionIds, optionId];
      }
    } else {
      // Single choice
      newSelected = [optionId];
    }

    this.activeItem.set({
      ...current,
      selectedOptionIds: newSelected,
    });
  }

  confirmActiveAnswer(): void {
    const current = this.activeItem();
    if (!current || current.isConfirmed) return;

    const selected = current.selectedOptionIds;
    if (selected.length === 0) return;

    const correctOptions = current.question.options.filter((o) => o.isCorrect);
    const correctOptionIds = new Set(correctOptions.map((o) => o.id));

    // Binary check: ALL correct answers chosen AND NO incorrect answers
    const allCorrectChosen =
      correctOptions.length > 0 && correctOptions.every((o) => selected.includes(o.id));
    const noIncorrectChosen = selected.every((id) => correctOptionIds.has(id));

    const isFullyCorrect = allCorrectChosen && noIncorrectChosen;

    // Retrieve or create question memory record
    const hash = current.question.hash;
    const existing = this.getMemoryRecord(hash);
    const prevHistory = existing?.history ? [...existing.history] : [];

    // Append new result (boolean) and keep at most the last 5 results
    const newHistory = [...prevHistory, isFullyCorrect].slice(-QUIZ_CONFIG.MAX_HISTORY_ENTRIES);
    const isExcluded = current.isExcluded ?? existing?.neverAskAgain ?? false;

    const memoryRecord: QuestionMemoryRecord = {
      hash,
      question: current.question.title,
      options: current.question.options.map((o) => o.text),
      history: newHistory,
      neverAskAgain: isExcluded,
      updatedAt: new Date().toISOString(),
    };

    this.saveMemoryRecord(memoryRecord);

    const confirmedItem: ActiveQuestionItem = {
      ...current,
      isConfirmed: true,
      isFullyCorrect,
      answeredAt: new Date(),
      isExcluded,
      memoryHistory: newHistory,
    };

    this.activeItem.set(confirmedItem);

    // Update session score
    this.answeredCount.update((c) => c + 1);
    if (isFullyCorrect) {
      this.correctCount.update((c) => c + 1);
    }
    this.saveStoredStats({
      answeredCount: this.answeredCount(),
      correctCount: this.correctCount(),
    });
  }

  /**
   * Toggles the "never ask again" (too simple) status for the currently active question.
   * Updates local memory immediately.
   */
  toggleNeverAskAgainActive(): void {
    const current = this.activeItem();
    if (!current) return;

    const newExcluded = !current.isExcluded;
    this.updateQuestionExcluded(current.question, newExcluded);

    this.activeItem.set({
      ...current,
      isExcluded: newExcluded,
    });
  }

  /**
   * Toggles the "never ask again" status for a question by its hash (used e.g. from history).
   */
  toggleQuestionExcludedByHash(hash: string): void {
    const q = this.allQuestions().find((item) => item.hash === hash);
    if (!q) return;

    const existing = this.getMemoryRecord(hash);
    const newExcluded = !existing?.neverAskAgain;
    this.updateQuestionExcluded(q, newExcluded);

    // Update activeItem if it matches
    const active = this.activeItem();
    if (active && active.question.hash === hash) {
      this.activeItem.set({
        ...active,
        isExcluded: newExcluded,
      });
    }

    // Update history items
    this.history.update((list) =>
      list.map((item) =>
        item.question.hash === hash ? { ...item, isExcluded: newExcluded } : item,
      ),
    );
  }

  private updateQuestionExcluded(question: Question, excluded: boolean): void {
    const existing = this.getMemoryRecord(question.hash);
    const updatedRecord: QuestionMemoryRecord = {
      hash: question.hash,
      question: question.title,
      options: question.options.map((o) => o.text),
      history: existing?.history ? [...existing.history] : [],
      neverAskAgain: excluded,
      updatedAt: new Date().toISOString(),
    };

    this.saveMemoryRecord(updatedRecord);
  }

  nextQuestion(): void {
    const current = this.activeItem();
    if (current && current.isConfirmed) {
      this.history.update((prev) => [current, ...prev]);
    }

    this.loadNextQuestionAtTop();
  }

  startRetryMode(): void {
    if (this.failedCount() === 0) return;
    this.isRetryMode.set(true);
    this.loadNextQuestionAtTop();
  }

  exitRetryMode(): void {
    this.isRetryMode.set(false);
    this.loadNextQuestionAtTop();
  }

  clearQuestionMemory(): void {
    try {
      const indexRaw = localStorage.getItem(QUIZ_CONFIG.STORAGE_INDEX_KEY);
      if (indexRaw) {
        const hashes: string[] = JSON.parse(indexRaw);
        for (const hash of hashes) {
          localStorage.removeItem(hash);
        }
        localStorage.removeItem(QUIZ_CONFIG.STORAGE_INDEX_KEY);
      }
      localStorage.removeItem(QUIZ_CONFIG.STORAGE_STATS_KEY);
    } catch {}

    this.questionMemoryMap.set(new Map());
    this.resetSession(true);
  }

  unexcludeAllQuestions(): void {
    const map = this.questionMemoryMap();
    map.forEach((record) => {
      if (record.neverAskAgain) {
        this.saveMemoryRecord({
          ...record,
          neverAskAgain: false,
        });
      }
    });

    const active = this.activeItem();
    if (active && active.isExcluded) {
      this.activeItem.set({ ...active, isExcluded: false });
    }
  }

  toggleHistory(): void {
    this.showHistory.update((v) => !v);
  }

  updateMarkdownAndReload(newMarkdown: string): void {
    this.rawMarkdown.set(newMarkdown);
    this.initQuestions(newMarkdown);
  }
}
