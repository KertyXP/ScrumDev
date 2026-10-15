import { Component, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuizService } from '../../services/quiz.service';

@Component({
  selector: 'app-markdown-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './markdown-modal.html',
  styleUrl: './markdown-modal.css',
})
export class MarkdownModalComponent {
  readonly quiz = inject(QuizService);

  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();

  readonly markdownInput = signal<string>('');
  readonly parsePreviewCount = signal<number>(0);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        const current = this.quiz.rawMarkdown();
        this.markdownInput.set(current);
        this.updatePreviewCount(current);
      }
    });
  }

  onMarkdownChange(content: string): void {
    this.markdownInput.set(content);
    this.updatePreviewCount(content);
  }

  updatePreviewCount(content: string): void {
    const matches = content.match(/^#{1,4}\s+[^\n]+/gm);
    this.parsePreviewCount.set(matches ? matches.length : 0);
  }

  onApply(): void {
    this.quiz.updateMarkdownAndReload(this.markdownInput());
    this.close.emit();
  }

  onReloadDefault(): void {
    this.quiz.loadDefaultQuestions();
    this.close.emit();
  }

  onFileUpload(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    if (inputEl.files && inputEl.files.length > 0) {
      const file = inputEl.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          this.markdownInput.set(text);
          this.updatePreviewCount(text);
        }
      };
      reader.readAsText(file);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
