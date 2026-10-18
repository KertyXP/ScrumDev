import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { QuizService, parseMarkdownQuestions } from './quiz.service';
import { computeQuestionHash, calculateFailureRate, isRecentlyFailed } from '../utils/hash.util';
import { QUIZ_CONFIG } from '../config/quiz.config';

describe('Quiz Local Memory & Hashing', () => {
  const sampleMarkdown = `### What is Refactoring?

- [ ] Adding new features.
- [x] Improving internal code structure without changing external behavior.
- [ ] Rewriting from scratch.

### When should testing occur in Scrum?

- [x] Throughout the Sprint.
- [ ] Only at the end of the Sprint.
- [ ] During the Sprint Retrospective.

### What is the Sprint Goal?

- [ ] A list of all tasks.
- [x] An objective set for the Sprint that can be met through implementation of the Product Backlog.
- [ ] A deadline.
`;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('computeQuestionHash', () => {
    it('should generate deterministic hashes independent of option presentation order', () => {
      const title = 'What is Scrum?';
      const optionsA = [{ text: 'A framework' }, { text: 'A methodology' }];
      const optionsB = [{ text: 'A methodology' }, { text: 'A framework' }];

      const hashA = computeQuestionHash(title, optionsA);
      const hashB = computeQuestionHash(title, optionsB);

      expect(hashA).toBe(hashB);
      expect(hashA.startsWith('q_')).toBe(true);
    });

    it('should generate distinct hashes for different questions', () => {
      const hash1 = computeQuestionHash('Question 1', [{ text: 'Answer A' }]);
      const hash2 = computeQuestionHash('Question 2', [{ text: 'Answer A' }]);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('calculateFailureRate & isRecentlyFailed', () => {
    it('should calculate failure rate correctly for 5 results', () => {
      // 3 failures out of 5 = 60%
      const history = [false, true, false, false, true];
      expect(calculateFailureRate(history)).toBe(0.6);
      expect(isRecentlyFailed(history, 0.4)).toBe(true);
    });

    it('should not consider <= 40% failure rate as recently failed', () => {
      // 2 failures out of 5 = 40%
      const history = [false, true, true, false, true];
      expect(calculateFailureRate(history)).toBe(0.4);
      expect(isRecentlyFailed(history, 0.4)).toBe(false);
    });
  });

  describe('QuizService Local Memory Operations', () => {
    let service: QuizService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [QuizService, provideHttpClient()],
      });
      service = TestBed.inject(QuizService);
      service.initQuestions(sampleMarkdown);
    });

    it('should load parsed questions with valid hashes', () => {
      const questions = service.allQuestions();
      expect(questions.length).toBe(3);
      for (const q of questions) {
        expect(q.hash).toBeDefined();
        expect(q.hash.startsWith('q_')).toBe(true);
      }
    });

    it('should store answered question in localStorage with key=hash and value containing question, options, and history (max 5)', () => {
      const active = service.activeItem();
      expect(active).toBeTruthy();
      if (!active) return;

      const hash = active.question.hash;

      // Select an option and confirm
      service.toggleOption(active.question.options[0].id);
      service.confirmActiveAnswer();

      // Check localStorage
      const storedRaw = localStorage.getItem(hash);
      expect(storedRaw).toBeTruthy();

      const stored = JSON.parse(storedRaw!);
      expect(stored.hash).toBe(hash);
      expect(stored.question).toBe(active.question.title);
      expect(Array.isArray(stored.options)).toBe(true);
      expect(Array.isArray(stored.history)).toBe(true);
      expect(stored.history.length).toBe(1);
      expect(typeof stored.history[0]).toBe('boolean');
      expect(stored.neverAskAgain).toBe(false);
    });

    it('should keep at most 5 results in question history', () => {
      const active = service.activeItem();
      expect(active).toBeTruthy();
      if (!active) return;

      const hash = active.question.hash;

      // Simulate 7 attempts saved
      for (let i = 0; i < 7; i++) {
        const isSuccess = i % 2 === 0;
        const existing = service.getMemoryRecord(hash);
        const prev = existing?.history ?? [];
        service.saveMemoryRecord({
          hash,
          question: active.question.title,
          options: active.question.options.map((o) => o.text),
          history: [...prev, isSuccess].slice(-QUIZ_CONFIG.MAX_HISTORY_ENTRIES),
          neverAskAgain: false,
        });
      }

      const record = service.getMemoryRecord(hash);
      expect(record?.history.length).toBe(5);
    });

    it('should toggle neverAskAgain and exclude question from future draws', () => {
      const active = service.activeItem();
      expect(active).toBeTruthy();
      if (!active) return;

      const hash = active.question.hash;

      // Select, confirm and mark as never ask again (trop simple)
      service.toggleOption(active.question.options[0].id);
      service.confirmActiveAnswer();
      service.toggleNeverAskAgainActive();

      const record = service.getMemoryRecord(hash);
      expect(record?.neverAskAgain).toBe(true);

      const stats = service.memoryStats();
      expect(stats.excludedCount).toBe(1);

      // Verify localStorage persisted neverAskAgain = true
      const stored = JSON.parse(localStorage.getItem(hash)!);
      expect(stored.neverAskAgain).toBe(true);
    });

    it('should persist overall stats (answeredCount, correctCount, overall score) in localStorage across restarts', () => {
      const active = service.activeItem();
      expect(active).toBeTruthy();
      if (!active) return;

      // Confirm correct answer
      const correctOption = active.question.options.find((o) => o.isCorrect);
      expect(correctOption).toBeTruthy();
      service.toggleOption(correctOption!.id);
      service.confirmActiveAnswer();

      expect(service.answeredCount()).toBe(1);
      expect(service.correctCount()).toBe(1);
      expect(service.ratingPercentage()).toBe(100);

      // Verify localStorage has the stats
      const storedStatsRaw = localStorage.getItem(QUIZ_CONFIG.STORAGE_STATS_KEY);
      expect(storedStatsRaw).toBeTruthy();
      const storedStats = JSON.parse(storedStatsRaw!);
      expect(storedStats.answeredCount).toBe(1);
      expect(storedStats.correctCount).toBe(1);

      // Simulate app shutdown and reopen (new service instance with same localStorage)
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [QuizService, provideHttpClient()],
      });
      const reopenedService = TestBed.inject(QuizService);
      reopenedService.initQuestions(sampleMarkdown);

      // Stats are restored!
      expect(reopenedService.answeredCount()).toBe(1);
      expect(reopenedService.correctCount()).toBe(1);
      expect(reopenedService.ratingPercentage()).toBe(100);
      expect(reopenedService.sessionStats().ratingPercentage).toBe(100);

      // But question history list is empty (as requested)
      expect(reopenedService.history().length).toBe(0);
    });
  });
});
