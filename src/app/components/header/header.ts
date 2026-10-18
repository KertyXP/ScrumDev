import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QuizService } from '../../services/quiz.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class HeaderComponent {
  readonly quiz = inject(QuizService);
  readonly openEditor = output<void>();

  onResetSession(): void {
    if (window.confirm('Voulez-vous réinitialiser le score et démarrer une nouvelle session ?')) {
      this.quiz.resetSession(true);
    }
  }

  onOpenEditor(): void {
    this.openEditor.emit();
  }

  onClearMemory(): void {
    if (
      window.confirm(
        'Voulez-vous réinitialiser l’historique local des questions et les exclusions ?',
      )
    ) {
      this.quiz.clearQuestionMemory();
    }
  }

  onUnexcludeAll(): void {
    if (
      window.confirm(
        'Voulez-vous réintégrer toutes les questions marquées comme "trop simples" ?',
      )
    ) {
      this.quiz.unexcludeAllQuestions();
    }
  }
}
