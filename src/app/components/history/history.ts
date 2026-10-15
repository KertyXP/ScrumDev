import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QuizService } from '../../services/quiz.service';
import { QuestionCardComponent } from '../question-card/question-card';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, QuestionCardComponent],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class HistoryComponent {
  readonly quiz = inject(QuizService);

  onToggleHistory(): void {
    this.quiz.toggleHistory();
  }
}
