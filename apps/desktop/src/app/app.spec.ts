import type { AppSettings, Project, RepoLensAPI, Result, ScanSummary } from '@repolens/shared';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

function notImplemented<T>(): Promise<Result<T>> {
  return Promise.resolve({
    ok: false,
    error: { code: 'NOT_IMPLEMENTED', message: 'This operation is not available in Phase 1.' },
  });
}

function createTestBridge(getVersion: () => Promise<string>): RepoLensAPI {
  return {
    app: {
      getVersion,
      getPlatform: async () => 'linux',
    },
    projects: {
      list: () => notImplemented<readonly Project[]>(),
    },
    scans: {
      getStatus: () => notImplemented<ScanSummary | null>(),
    },
    settings: {
      get: () => notImplemented<AppSettings>(),
    },
  };
}

describe('App welcome screen', () => {
  let previousBridge: RepoLensAPI | undefined;

  beforeEach(async () => {
    previousBridge = window.repolens;
    Reflect.deleteProperty(window, 'repolens');
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  afterEach(() => {
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'repolens');
    } else {
      Object.defineProperty(window, 'repolens', {
        configurable: true,
        value: previousBridge,
      });
    }
  });

  it('renders RepoLens branding and accurately describes the foundation scope', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('RepoLens');
    expect(page.textContent).toContain('Analyze once. Understand anywhere.');
    expect(page.textContent).toContain('Foundation initialized');
    expect(page.textContent).toContain('Desktop runtime not detected');
    expect(page.textContent).toContain('Version Unavailable');
    expect(page.textContent).not.toContain('Total files');
  });

  it('displays the version returned by the secure Electron preload bridge', async () => {
    const getVersion = vi.fn(async () => '0.1.0');
    Object.defineProperty(window, 'repolens', {
      configurable: true,
      value: createTestBridge(getVersion),
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getVersion).toHaveBeenCalledOnce();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.app-version')?.textContent,
    ).toContain('Version 0.1.0');
    expect(fixture.nativeElement.textContent).toContain('Secure desktop bridge connected.');
  });
});
