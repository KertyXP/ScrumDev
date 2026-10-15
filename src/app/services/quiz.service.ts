import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActiveQuestionItem, Question, QuestionOption, SessionStats } from '../models/quiz.model';

const STORAGE_KEY_FAILED = 'scrumdev_failed_q_ids';

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
        instruction = parenMatch[1].trim();
      }

      const correctCount = currentOptions.filter((o) => o.isCorrect).length;

      let isMultipleChoice = correctCount > 1;

      questions.push({
        id: questions.length + 1,
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

  // The active question is displayed at the TOP
  readonly activeItem = signal<ActiveQuestionItem | null>(null);

  // Previously answered questions are displayed BELOW in reverse order (most recent first)
  readonly history = signal<ActiveQuestionItem[]>([]);
  readonly showHistory = signal<boolean>(true);

  // Failed questions memory & retry mode
  readonly failedQuestionIds = signal<number[]>(this.loadStoredFailedIds());
  readonly isRetryMode = signal<boolean>(false);
  readonly failedCount = computed<number>(() => this.failedQuestionIds().length);

  // Session scoring metrics
  readonly answeredCount = signal<number>(0);
  readonly correctCount = signal<number>(0);

  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  private remainingPool: Question[] = [];
  private lastQuestionId: number | null = null;
  private sessionCounter = 0;

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

  constructor() {
    this.loadDefaultQuestions();
  }

  private loadStoredFailedIds(): number[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FAILED);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveStoredFailedIds(ids: number[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_FAILED, JSON.stringify(ids));
    } catch {}
  }

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
    this.resetSession();

    if (parsed.length === 0) {
      this.errorMessage.set('No valid questions found in the Markdown file.');
    } else {
      this.errorMessage.set(null);
    }
  }

  resetSession(): void {
    this.remainingPool = [];
    this.lastQuestionId = null;
    this.sessionCounter = 0;
    this.answeredCount.set(0);
    this.correctCount.set(0);
    this.history.set([]);
    this.activeItem.set(null);
    this.isRetryMode.set(false);

    if (this.allQuestions().length > 0) {
      this.loadNextQuestionAtTop();
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private getNextRandomQuestion(): Question | null {
    const all = this.allQuestions();
    if (all.length === 0) return null;

    // In Retry Mode, pool contains only failed questions
    let candidatePool = all;
    if (this.isRetryMode()) {
      const failedSet = new Set(this.failedQuestionIds());
      candidatePool = all.filter((q) => failedSet.has(q.id));
      if (candidatePool.length === 0) {
        // All failed questions have been solved!
        this.isRetryMode.set(false);
        candidatePool = all;
      }
    }

    // Reshuffle questions when pool is empty to create an infinite cycle
    if (this.remainingPool.length === 0) {
      this.remainingPool = this.shuffleArray(candidatePool);

      // Avoid repeating the same question across cycle boundary if pool > 1
      if (this.remainingPool.length > 1 && this.remainingPool[0].id === this.lastQuestionId) {
        const swapIndex = Math.floor(Math.random() * (this.remainingPool.length - 1)) + 1;
        const temp = this.remainingPool[0];
        this.remainingPool[0] = this.remainingPool[swapIndex];
        this.remainingPool[swapIndex] = temp;
      }
    }

    const nextQ = this.remainingPool.shift()!;
    this.lastQuestionId = nextQ.id;
    return nextQ;
  }

  loadNextQuestionAtTop(): void {
    const nextQ = this.getNextRandomQuestion();
    if (!nextQ) return;

    this.sessionCounter++;
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
      // Single choice (radio)
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

    const confirmedItem: ActiveQuestionItem = {
      ...current,
      isConfirmed: true,
      isFullyCorrect,
      answeredAt: new Date(),
    };

    this.activeItem.set(confirmedItem);

    // Update session score
    this.answeredCount.update((c) => c + 1);
    if (isFullyCorrect) {
      this.correctCount.update((c) => c + 1);

      // If it was in failed questions, remove it now that it has been answered correctly!
      const currentFailed = this.failedQuestionIds();
      if (currentFailed.includes(current.question.id)) {
        const updated = currentFailed.filter((id) => id !== current.question.id);
        this.failedQuestionIds.set(updated);
        this.saveStoredFailedIds(updated);
      }
    } else {
      // Question answered incorrectly -> memorize it in failed questions
      const currentFailed = this.failedQuestionIds();
      if (!currentFailed.includes(current.question.id)) {
        const updated = [...currentFailed, current.question.id];
        this.failedQuestionIds.set(updated);
        this.saveStoredFailedIds(updated);
      }
    }
  }

  nextQuestion(): void {
    const current = this.activeItem();
    if (current && current.isConfirmed) {
      // Archive current question into history (prepended, so it sits right below the active question)
      this.history.update((prev) => [current, ...prev]);
    }

    // Load new random question at the TOP
    this.loadNextQuestionAtTop();
  }

  startRetryMode(): void {
    if (this.failedCount() === 0) return;
    this.isRetryMode.set(true);
    this.remainingPool = []; // will trigger reshuffle of failed questions
    this.loadNextQuestionAtTop();
  }

  exitRetryMode(): void {
    this.isRetryMode.set(false);
    this.remainingPool = []; // will trigger reshuffle of all questions
    this.loadNextQuestionAtTop();
  }

  clearFailedQuestions(): void {
    this.failedQuestionIds.set([]);
    this.saveStoredFailedIds([]);
    if (this.isRetryMode()) {
      this.exitRetryMode();
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
