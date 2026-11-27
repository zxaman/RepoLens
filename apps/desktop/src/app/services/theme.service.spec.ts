import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ThemeService] });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies explicit light and dark themes and defers system theme to the operating system', () => {
    const service = TestBed.inject(ThemeService);
    const root = document.documentElement;

    service.apply('light');
    expect(root.getAttribute('data-theme')).toBe('light');

    service.apply('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    service.apply('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
