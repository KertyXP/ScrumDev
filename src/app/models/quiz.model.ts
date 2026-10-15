export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: number;
  title: string;
  instruction?: string;
  options: QuestionOption[];
  isMultipleChoice: boolean;
  expectedCorrectCount: number;
}

export interface ActiveQuestionItem {
  streamId: string;
  question: Question;
  selectedOptionIds: string[];
  isConfirmed: boolean;
  isFullyCorrect: boolean | null;
  questionNumber: number;
  answeredAt?: Date;
}

export interface SessionStats {
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  ratingPercentage: number;
}
