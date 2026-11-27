import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import type { AppSettings } from '@repolens/shared';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  apply(theme: AppSettings['theme']): void {
    const root = this.document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      return;
    }
    root.setAttribute('data-theme', theme);
  }
}
