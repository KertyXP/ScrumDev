import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QuizService } from './services/quiz.service';
import { HeaderComponent } from './components/header/header';
import { QuestionCardComponent } from './components/question-card/question-card';
import { HistoryComponent } from './components/history/history';
import { MarkdownModalComponent } from './components/markdown-modal/markdown-modal';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    QuestionCardComponent,
    HistoryComponent,
    MarkdownModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly quiz = inject(QuizService);
  readonly isEditorOpen = signal<boolean>(false);

  onConfirm(): void {
    this.quiz.confirmActiveAnswer();
  }

  onNext(): void {
    this.quiz.nextQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  openEditor(): void {
    this.isEditorOpen.set(true);
  }

  closeEditor(): void {
    this.isEditorOpen.set(false);
  }
}
