import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Project, ProjectImportPreview, RepoLensAPI } from '@repolens/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../services/project.service';
import { ProjectImportButtonComponent } from './project-import-button.component';

const project: Project = {
  id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  name: 'sample-project',
  rootPath: '/work/sample-project',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
};

const preview: ProjectImportPreview = {
  selectionId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
  name: project.name,
  rootPath: project.rootPath,
  repositoryType: 'local',
  repositoryIndicators: [],
};

describe('ProjectImportButtonComponent', () => {
  let previousBridge: RepoLensAPI | undefined;
  let projectService: {
    importFolder: ReturnType<typeof vi.fn>;
    confirmImport: ReturnType<typeof vi.fn>;
    cancelImport: ReturnType<typeof vi.fn>;
    openProject: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    previousBridge = window.repolens;
    Object.defineProperty(window, 'repolens', {
      configurable: true,
      value: {} as RepoLensAPI,
    });
    projectService = {
      importFolder: vi.fn(async () => ({ kind: 'selected' as const, preview })),
      confirmImport: vi.fn(async () => ({ kind: 'created' as const, project })),
      cancelImport: vi.fn(async () => undefined),
      openProject: vi.fn(async () => project),
    };
    router = { navigate: vi.fn(async () => true) };

    await TestBed.configureTestingModule({
      imports: [ProjectImportButtonComponent],
      providers: [
        { provide: ProjectService, useValue: projectService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'repolens');
    } else {
      Object.defineProperty(window, 'repolens', {
        configurable: true,
        value: previousBridge,
      });
    }
  });

  it('previews a folder, confirms registration, activates it, and navigates to its dashboard', async () => {
    const fixture = TestBed.createComponent(ProjectImportButtonComponent);
    const registered = vi.fn();
    fixture.componentInstance.registered.subscribe(registered);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    page.querySelector<HTMLButtonElement>('.import-button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(projectService.importFolder).toHaveBeenCalledOnce();
    expect(page.textContent).toContain('sample-project');
    expect(page.textContent).toContain('/work/sample-project');

    page.querySelector<HTMLButtonElement>('.button-primary')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(projectService.confirmImport).toHaveBeenCalledWith(preview.selectionId);
    expect(projectService.openProject).toHaveBeenCalledWith(project.id);
    expect(router.navigate).toHaveBeenCalledWith(['/projects', project.id]);
    expect(registered).toHaveBeenCalledWith(project);
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it('handles picker cancellation and duplicate registrations without creating another project', async () => {
    projectService.importFolder.mockResolvedValueOnce({ kind: 'cancelled' });
    const fixture = TestBed.createComponent(ProjectImportButtonComponent);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    page.querySelector<HTMLButtonElement>('.import-button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.querySelector('[role="dialog"]')).toBeNull();

    projectService.importFolder.mockResolvedValueOnce({ kind: 'duplicate', project });
    page.querySelector<HTMLButtonElement>('.import-button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.textContent).toContain('This project is already in RepoLens');

    page.querySelector<HTMLButtonElement>('.button-primary')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(projectService.confirmImport).not.toHaveBeenCalled();
    expect(projectService.openProject).toHaveBeenCalledWith(project.id);
    expect(router.navigate).toHaveBeenCalledWith(['/projects', project.id]);
  });

  it('disables folder import when rendered in a browser without the Electron bridge', async () => {
    Reflect.deleteProperty(window, 'repolens');
    const fixture = TestBed.createComponent(ProjectImportButtonComponent);
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.import-button',
    );
    expect(button?.disabled).toBe(true);
    expect(button?.title).toContain('desktop application');
    expect(projectService.importFolder).not.toHaveBeenCalled();
  });
});
