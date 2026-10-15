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

  onToggleRetryMode(): void {
    if (this.quiz.isRetryMode()) {
      this.quiz.exitRetryMode();
    } else {
      this.quiz.startRetryMode();
    }
  }

  onResetSession(): void {
    this.quiz.resetSession();
  }

  onOpenEditor(): void {
    this.openEditor.emit();
  }
}
