import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveQuestionItem, QuestionOption } from '../../models/quiz.model';
import { QuizService } from '../../services/quiz.service';

@Component({
  selector: 'app-question-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './question-card.html',
  styleUrl: './question-card.css',
})
export class QuestionCardComponent {
  readonly quiz = inject(QuizService);

  readonly item = input.required<ActiveQuestionItem>();
  readonly isActive = input<boolean>(false);

  readonly confirm = output<void>();
  readonly next = output<void>();

  readonly canConfirm = computed<boolean>(() => {
    const it = this.item();
    return this.isActive() && !it.isConfirmed && it.selectedOptionIds.length > 0;
  });

  readonly displayInstruction = computed<string | null>(() => {
    const inst = this.item().question.instruction;
    if (!inst) return null;
    const lower = inst.toLowerCase();
    if (lower.includes('choose the best answer') || lower.includes('choose best answer')) {
      return null;
    }
    return inst;
  });

  getOptionStatus(option: QuestionOption): {
    status: 'correct-picked' | 'correct-missed' | 'incorrect-picked' | 'neutral';
    label: string;
  } {
    const it = this.item();
    if (!it.isConfirmed) {
      return { status: 'neutral', label: '' };
    }

    const isSelected = it.selectedOptionIds.includes(option.id);

    if (option.isCorrect) {
      if (isSelected) {
        return { status: 'correct-picked', label: '✓ Correct answer' };
      } else {
        return { status: 'correct-missed', label: '★ Expected answer' };
      }
    } else {
      if (isSelected) {
        return { status: 'incorrect-picked', label: '✕ Incorrect answer' };
      } else {
        return { status: 'neutral', label: '' };
      }
    }
  }

  onToggleOption(optionId: string): void {
    if (this.isActive() && !this.item().isConfirmed) {
      this.quiz.toggleOption(optionId);
    }
  }

  onConfirm(): void {
    if (this.canConfirm()) {
      this.confirm.emit();
    }
  }

  onNext(): void {
    this.next.emit();
  }

  onToggleNeverAskAgain(): void {
    if (this.isActive()) {
      this.quiz.toggleNeverAskAgainActive();
    } else {
      this.quiz.toggleQuestionExcludedByHash(this.item().question.hash);
    }
  }
}
