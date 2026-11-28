import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import {
  DEFAULT_APP_SETTINGS,
  scanHistoryItemSchema,
  scanResultSchema,
  type Project,
  type ScanHistoryItem,
  type ScanProgress,
  type ScanResult,
} from '@repolens/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../settings/settings.service';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import { ProjectService } from '../services/project.service';
import { ScanService } from '../services/scan.service';
import { ProjectDetailsPageComponent } from './project-details-page.component';

const project: Project = {
  id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  name: 'fixture-project',
  rootPath: '/fixture/scanner/basic',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
};

const summary: ScanHistoryItem = scanHistoryItemSchema.parse({
  id: '92370c1b-8755-4057-ae23-0d885ad4d94b',
  projectId: project.id,
  status: 'completed',
  startedAt: '2026-11-27T00:00:00.000Z',
  completedAt: '2026-11-27T00:00:01.000Z',
  durationMs: 1_000,
  directoriesDiscovered: 2,
  filesDiscovered: 1,
  filesProcessed: 1,
  sourceFiles: 1,
  configurationFiles: 0,
  packageManifests: 0,
  documentationFiles: 0,
  assetFiles: 0,
  otherFiles: 0,
  ignoredFiles: 0,
  ignoredDirectories: 0,
  sensitiveEntriesExcluded: 0,
  symlinksSkipped: 0,
  bytesHashed: 8,
  languages: [{ name: 'TypeScript', fileCount: 1, totalBytes: 8 }],
  technologies: [
    {
      name: 'React',
      category: 'frontend',
      certainty: 'confirmed',
      confidence: 'high',
      evidence: ['package.json: react'],
    },
  ],
  warnings: [],
});

const result: ScanResult = scanResultSchema.parse({
  ...summary,
  files: [
    {
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 8,
      modifiedAt: '2026-11-27T00:00:00.000Z',
      classification: 'source',
      language: 'TypeScript',
      hashStatus: 'hashed',
      sha256: 'a'.repeat(64),
    },
  ],
  errors: [],
});

describe('ProjectDetailsPageComponent scan UI', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let scanProgressListener: ((progress: ScanProgress) => void) | null;
  let scanService: {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    getLatest: ReturnType<typeof vi.fn>;
    onProgress: ReturnType<typeof vi.fn>;
  };
  let projectService: {
    getProject: ReturnType<typeof vi.fn>;
    openProject: ReturnType<typeof vi.fn>;
    refreshProject: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ projectId: project.id }));
    scanProgressListener = null;
    scanService = {
      start: vi.fn(async () => result),
      cancel: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => [] as readonly ScanHistoryItem[]),
      getLatest: vi.fn(async () => null as ScanHistoryItem | null),
      onProgress: vi.fn((callback: (progress: ScanProgress) => void) => {
        scanProgressListener = callback;
        return vi.fn();
      }),
    };
    projectService = {
      getProject: vi.fn(async () => project),
      openProject: vi.fn(async () => project),
      refreshProject: vi.fn(async () => project),
      removeProject: vi.fn(async () => undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ProjectDetailsPageComponent],
      providers: [
        { provide: ProjectService, useValue: projectService },
        { provide: ScanService, useValue: scanService },
        {
          provide: SettingsService,
          useValue: { load: async () => ({ ...DEFAULT_APP_SETTINGS }) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
      ],
    })
      .overrideComponent(ProjectDetailsPageComponent, {
        set: { imports: [DatePipe, ConfirmRemoveDialogComponent] },
      })
      .compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows saved history and the completed per-file metadata and digest from a scan', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('Repository scan');
    expect(page.textContent).toContain('Configure scan exclusions');
    expect(page.textContent).toContain('Not scanned yet');

    const component = fixture.componentInstance;
    component.scanningProjectId.set(project.id);
    component.scanning.set(true);
    scanProgressListener?.({
      scanId: result.id,
      projectId: project.id,
      phase: 'walking',
      filesDiscovered: 2,
      filesProcessed: 0,
      directoriesProcessed: 1,
      totalBytesProcessed: 0,
    });
    fixture.detectChanges();
    expect(page.textContent).toContain('Discovering project files');
    component.scanning.set(false);
    component.scanningProjectId.set(null);

    await component.startScan();
    fixture.detectChanges();

    expect(scanService.start).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        includeSensitiveFiles: false,
        acknowledgeSensitiveFileRisk: false,
      }),
    );
    expect(page.textContent).toContain('Scan completed');
    expect(page.textContent).toContain('React');
    expect(page.textContent).toContain('src/index.ts');
    expect(page.textContent).toContain('aaaaaaaaaaaaaaaa…');
  });

  it('requires the explicit risk acknowledgement before enabling sensitive-file inclusion', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const page = fixture.nativeElement as HTMLElement;
    const includeCheckbox = page.querySelector<HTMLInputElement>('.sensitive-toggle input');
    expect(includeCheckbox).not.toBeNull();

    includeCheckbox!.checked = true;
    includeCheckbox!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(page.textContent).toMatch(/sensitive paths may contain credentials or private keys/i);
    expect(component.acknowledgeSensitiveFileRisk()).toBe(false);

    const startButton = Array.from(page.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Start scan'),
    );
    expect(startButton?.disabled).toBe(true);
    component.acknowledgeSensitiveFileRisk.set(true);
    fixture.detectChanges();
    expect(startButton?.disabled).toBe(false);
  });
});
