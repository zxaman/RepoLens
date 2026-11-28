import type {
  AnalysisResult,
  AppSettings,
  GraphCycleReport,
  GraphNodeQueryResult,
  GraphPathResult,
  GraphSummary,
  GraphTraversalResult,
  Project,
  ProjectImportCommitResult,
  ProjectImportResult,
  RepoLensAPI,
  Result,
  ScanHistoryItem,
  ScanResult,
} from '@repolens/shared';
import { DEFAULT_APP_SETTINGS } from '@repolens/shared';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ProjectService } from './features/projects/services/project.service';
import { routes } from './app.routes';

function notImplemented<T>(): Promise<Result<T>> {
  return Promise.resolve({
    ok: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'This operation is not implemented in the test mock.',
    },
  });
}

function success<T>(data: T): Promise<Result<T>> {
  return Promise.resolve({ ok: true, data });
}

function createTestBridge(
  getVersion: () => Promise<string>,
  settings: AppSettings = { ...DEFAULT_APP_SETTINGS },
  activeProject: Project | null = null,
  setActive: RepoLensAPI['projects']['setActive'] = () => notImplemented<Project>(),
): RepoLensAPI {
  let currentActiveProject = activeProject;
  let registeredProjects: readonly Project[] = activeProject === null ? [] : [activeProject];
  return {
    app: {
      getVersion,
      getPlatform: async () => 'linux',
    },
    projects: {
      importFolder: () => notImplemented<ProjectImportResult>(),
      confirmImport: () => notImplemented<ProjectImportCommitResult>(),
      cancelImport: () => notImplemented<{ readonly cancelled: true }>(),
      list: () => success<readonly Project[]>([...registeredProjects]),
      getById: () => success<Project | null>(null),
      getActive: () => success<Project | null>(currentActiveProject),
      setActive: async (id) => {
        const result = await setActive(id);
        if (result.ok) {
          currentActiveProject = result.data;
          if (!registeredProjects.some((project) => project.id === result.data.id)) {
            registeredProjects = [...registeredProjects, result.data];
          }
        }
        return result;
      },
      remove: () => notImplemented<{ readonly removed: true }>(),
      refresh: () => notImplemented<Project>(),
    },
    scans: {
      start: () => notImplemented<ScanResult>(),
      cancel: () => notImplemented<{ readonly cancelled: true }>(),
      onProgress: () => () => undefined,
      getHistory: () => success<readonly ScanHistoryItem[]>([]),
      getLatest: () => success<ScanHistoryItem | null>(null),
    },
    analysis: {
      start: () => notImplemented<AnalysisResult>(),
      cancel: () => notImplemented<{ readonly cancelled: true }>(),
      onProgress: () => () => undefined,
    },
    graphs: {
      onProgress: () => () => undefined,
      summary: () => notImplemented<GraphSummary | null>(),
      query: () => notImplemented<GraphNodeQueryResult | null>(),
      dependencies: () => notImplemented<GraphTraversalResult | null>(),
      shortestPath: () => notImplemented<GraphPathResult | null>(),
      cycles: () => notImplemented<GraphCycleReport | null>(),
      exportJson: () => notImplemented<string | null>(),
      dispose: () => notImplemented<{ readonly disposed: true }>(),
    },
    settings: {
      get: () => success<AppSettings>({ ...settings }),
      update: () => notImplemented<AppSettings>(),
      reset: () => success<AppSettings>({ ...DEFAULT_APP_SETTINGS }),
    },
  };
}

describe('App project-management shell', () => {
  let previousBridge: RepoLensAPI | undefined;

  beforeEach(async () => {
    previousBridge = window.repolens;
    Reflect.deleteProperty(window, 'repolens');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
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

  it('renders RepoLens branding and accurately describes project-management availability', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/welcome');
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('.brand-name')?.textContent).toContain('RepoLens');
    expect(page.textContent).toContain('Import Project');
    expect(page.textContent).toContain('Browser preview only.');
    expect(page.textContent).toContain('npm run dev:desktop');
    expect(page.querySelector('app-project-import-button button')?.hasAttribute('disabled')).toBe(
      true,
    );
    expect(page.textContent).toContain('Unavailable');
    expect(page.textContent).not.toContain('Total files');
  });

  it('displays the version returned by the secure Electron preload bridge', async () => {
    const getVersion = vi.fn(async () => '0.2.0');
    Object.defineProperty(window, 'repolens', {
      configurable: true,
      value: createTestBridge(getVersion),
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/welcome');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getVersion).toHaveBeenCalledOnce();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.app-version')?.textContent,
    ).toContain('0.2.0');
  });

  it('selects the saved default project on startup without starting a scan', async () => {
    const defaultProject: Project = {
      id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      name: 'sample-project',
      rootPath: '/tmp/sample-project',
      createdAt: '2026-11-27T00:00:00.000Z',
      updatedAt: '2026-11-27T00:00:00.000Z',
      status: 'registered',
      repositoryType: 'local',
      repositoryIndicators: [],
    };
    const setActive = vi.fn(async () => success(defaultProject));
    Object.defineProperty(window, 'repolens', {
      configurable: true,
      value: createTestBridge(
        async () => '0.2.0',
        { ...DEFAULT_APP_SETTINGS, defaultProjectId: defaultProject.id },
        null,
        setActive,
      ),
    });

    const projectService = TestBed.inject(ProjectService);
    const openProject = vi.spyOn(projectService, 'openProject');
    const setActiveProject = vi.spyOn(projectService.activeProject, 'set');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/welcome');
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(openProject).toHaveBeenCalledWith(defaultProject.id);
    });
    const openRequest = openProject.mock.results[0]?.value;
    if (openRequest !== undefined) {
      await openRequest;
    }
    fixture.detectChanges();

    expect(setActive).toHaveBeenCalledWith(defaultProject.id);
    expect(setActiveProject).toHaveBeenCalledWith(defaultProject);
    expect(setActiveProject).toHaveBeenLastCalledWith(defaultProject);
    expect(projectService.activeProject()).toEqual(defaultProject);
    expect(projectService.projects()).toContainEqual(defaultProject);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('sample-project');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Not scanned yet');
  });
});
