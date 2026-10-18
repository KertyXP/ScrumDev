export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: number;
  hash: string;
  title: string;
  instruction?: string;
  options: QuestionOption[];
  isMultipleChoice: boolean;
  expectedCorrectCount: number;
}

export interface QuestionMemoryRecord {
  hash: string;
  question: string;
  options: string[];
  history: boolean[]; // true = correct / réussi, false = failed / échec (max 5)
  neverAskAgain: boolean;
  updatedAt?: string;
}

export interface ActiveQuestionItem {
  streamId: string;
  question: Question;
  selectedOptionIds: string[];
  isConfirmed: boolean;
  isFullyCorrect: boolean | null;
  questionNumber: number;
  answeredAt?: Date;
  isExcluded?: boolean;
}

export interface SessionStats {
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  ratingPercentage: number;
}

export interface QuizMemoryStats {
  totalQuestions: number;
  unansweredCount: number;
  recentlyFailedCount: number;
  masteredCount: number;
  excludedCount: number;
}
