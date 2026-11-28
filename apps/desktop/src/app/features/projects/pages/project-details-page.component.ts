import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DEFAULT_SCAN_CONFIG,
  scanConfigSchema,
  type Project,
  type ScanConfig,
  type ScanFile,
  type ScanHistoryItem,
  type ScanPhase,
  type ScanProgress,
  type ScanResult,
} from '@repolens/shared';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import { ProjectService, toUserMessage } from '../services/project.service';
import { ScanService } from '../services/scan.service';
import { SettingsService } from '../../settings/settings.service';

@Component({
  selector: 'app-project-details-page',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmRemoveDialogComponent],
  templateUrl: './project-details-page.component.html',
  styleUrl: './project-details-page.component.scss',
})
export class ProjectDetailsPageComponent implements OnInit {
  readonly project = signal<Project | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly removing = signal(false);
  readonly showRemoveConfirmation = signal(false);
  readonly confirmBeforeRemoving = signal(true);
  readonly scanHistory = signal<readonly ScanHistoryItem[]>([]);
  readonly latestScan = signal<ScanHistoryItem | null>(null);
  readonly currentScan = signal<ScanResult | null>(null);
  readonly scanProgress = signal<ScanProgress | null>(null);
  readonly scanLoading = signal(false);
  readonly scanning = signal(false);
  readonly scanningProjectId = signal<string | null>(null);
  readonly cancellingScan = signal(false);
  readonly activeScanId = signal<string | null>(null);
  readonly scanError = signal('');
  readonly includeSensitiveFiles = signal(false);
  readonly acknowledgeSensitiveFileRisk = signal(false);
  readonly additionalExcludedDirectories = signal('');
  readonly additionalIgnorePatterns = signal('');
  readonly defaultExcludedDirectories = DEFAULT_SCAN_CONFIG.excludedDirectories;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectService = inject(ProjectService);
  private readonly scanService = inject(ScanService);
  private readonly settingsService = inject(SettingsService);
  private projectLoadRevision = 0;
  private unsubscribeFromProgress: (() => void) | null = null;

  ngOnInit(): void {
    void this.settingsService
      .load()
      .then((settings) => {
        this.confirmBeforeRemoving.set(settings.confirmBeforeRemovingProject);
      })
      .catch((error: unknown) => {
        this.actionError.set(toUserMessage(error, 'RepoLens could not load your settings.'));
      });

    try {
      this.unsubscribeFromProgress = this.scanService.onProgress((progress) => {
        if (progress.projectId !== this.scanningProjectId()) {
          return;
        }
        this.activeScanId.set(progress.scanId);
        this.scanProgress.set(progress);
      });
    } catch {
      // The details page remains useful in a browser without the desktop preload bridge.
    }
    this.destroyRef.onDestroy(() => this.unsubscribeFromProgress?.());

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.loadProject(params.get('projectId'));
    });
  }

  async refresh(): Promise<void> {
    const current = this.project();
    if (current === null) {
      return;
    }
    this.actionError.set('');
    try {
      const updated = await this.projectService.refreshProject(current.id);
      this.project.set(updated);
      if (updated.status === 'registered') {
        await this.projectService.openProject(updated.id);
      }
    } catch (error) {
      this.actionError.set(toUserMessage(error, 'RepoLens could not refresh this project folder.'));
    }
  }

  setSensitiveFileInclusion(enabled: boolean): void {
    this.includeSensitiveFiles.set(enabled);
    if (!enabled) {
      this.acknowledgeSensitiveFileRisk.set(false);
    }
  }

  async startScan(): Promise<void> {
    const current = this.project();
    if (
      current === null ||
      current.status !== 'registered' ||
      this.scanning() ||
      (this.includeSensitiveFiles() && !this.acknowledgeSensitiveFileRisk())
    ) {
      return;
    }

    this.actionError.set('');
    this.scanError.set('');
    this.scanProgress.set(null);
    this.activeScanId.set(null);
    this.currentScan.set(null);
    this.scanning.set(true);
    this.scanningProjectId.set(current.id);
    try {
      const config = this.buildScanConfig();
      const result = await this.scanService.start(current.id, config);
      if (this.project()?.id !== current.id) {
        return;
      }
      this.currentScan.set(result);
      this.latestScan.set(result);
      this.scanHistory.update((history) => [
        result,
        ...history.filter((item) => item.id !== result.id),
      ]);
      if (result.status === 'failed') {
        this.scanError.set(result.errorSummary ?? 'RepoLens could not complete this scan.');
      } else if (result.status === 'cancelled') {
        this.scanError.set(
          'The scan was cancelled. Results include work completed before cancellation.',
        );
      }
      await this.loadScanHistory(current.id, this.projectLoadRevision);
    } catch (error) {
      if (this.project()?.id === current.id) {
        this.actionError.set(
          toUserMessage(error, 'RepoLens could not start or complete the scan.'),
        );
      }
    } finally {
      this.scanning.set(false);
      this.cancellingScan.set(false);
      this.scanningProjectId.set(null);
      this.activeScanId.set(null);
    }
  }

  async cancelScan(): Promise<void> {
    const scanId = this.activeScanId();
    if (scanId === null || !this.scanning() || this.cancellingScan()) {
      return;
    }
    this.cancellingScan.set(true);
    this.actionError.set('');
    try {
      await this.scanService.cancel(scanId);
    } catch (error) {
      this.actionError.set(toUserMessage(error, 'RepoLens could not cancel the scan.'));
      this.cancellingScan.set(false);
    }
  }

  requestRemove(): void {
    if (this.confirmBeforeRemoving()) {
      this.showRemoveConfirmation.set(true);
      return;
    }
    void this.removeCurrentProject();
  }

  async confirmRemove(): Promise<void> {
    this.showRemoveConfirmation.set(false);
    await this.removeCurrentProject();
  }

  closeRemoveDialog(): void {
    this.showRemoveConfirmation.set(false);
  }

  phaseLabel(phase: ScanPhase): string {
    const labels: Record<ScanPhase, string> = {
      initializing: 'Preparing the scanner',
      walking: 'Discovering project files',
      classifying: 'Classifying discovered files',
      detecting: 'Checking safe configuration evidence',
      hashing: 'Calculating SHA-256 file hashes',
      finalizing: 'Finalizing scan results',
    };
    return labels[phase];
  }

  progressPercent(progress: ScanProgress): number | null {
    if (progress.percentage !== undefined) {
      return progress.percentage;
    }
    if (progress.filesTotal !== undefined && progress.filesTotal > 0) {
      return Math.round((progress.filesProcessed / progress.filesTotal) * 100);
    }
    return null;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = -1;
    do {
      value /= 1024;
      unitIndex += 1;
    } while (value >= 1024 && unitIndex < units.length - 1);
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? 'TB'}`;
  }

  shortHash(file: ScanFile): string {
    return file.sha256 === undefined ? 'Not hashed' : `${file.sha256.slice(0, 16)}…`;
  }

  private buildScanConfig(): ScanConfig {
    const extraDirectories = this.additionalExcludedDirectories()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const excludePatterns = this.additionalIgnorePatterns()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const config = scanConfigSchema.safeParse({
      ...DEFAULT_SCAN_CONFIG,
      excludedDirectories: [
        ...new Set([...DEFAULT_SCAN_CONFIG.excludedDirectories, ...extraDirectories]),
      ],
      excludePatterns,
      includeSensitiveFiles: this.includeSensitiveFiles(),
      acknowledgeSensitiveFileRisk: this.acknowledgeSensitiveFileRisk(),
    });
    if (!config.success) {
      throw new Error('Check the additional exclude directories and patterns, then try again.');
    }
    return config.data;
  }

  private async removeCurrentProject(): Promise<void> {
    const current = this.project();
    if (current === null) {
      return;
    }
    this.removing.set(true);
    this.actionError.set('');
    try {
      await this.projectService.removeProject(current.id);
      await this.router.navigate(['/projects']);
    } catch (error) {
      this.actionError.set(
        toUserMessage(error, 'RepoLens could not remove that project registration.'),
      );
    } finally {
      this.removing.set(false);
    }
  }

  private async loadProject(projectId: string | null): Promise<void> {
    const revision = ++this.projectLoadRevision;
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    this.scanError.set('');
    this.project.set(null);
    this.scanHistory.set([]);
    this.latestScan.set(null);
    this.scanLoading.set(false);
    this.currentScan.set(null);
    this.scanProgress.set(null);
    if (projectId === null) {
      this.error.set('This project link is invalid.');
      this.loading.set(false);
      return;
    }

    try {
      const project = await this.projectService.getProject(projectId);
      if (revision !== this.projectLoadRevision) {
        return;
      }
      if (project === null) {
        this.error.set('This project is no longer registered.');
        return;
      }
      this.project.set(project);
      const activeProject =
        project.status === 'registered'
          ? await this.projectService.openProject(project.id)
          : project;
      if (revision !== this.projectLoadRevision) {
        return;
      }
      this.project.set(activeProject);
      await this.loadScanHistory(activeProject.id, revision);
    } catch (error) {
      if (revision === this.projectLoadRevision) {
        this.error.set(toUserMessage(error, 'RepoLens could not load this project.'));
      }
    } finally {
      if (revision === this.projectLoadRevision) {
        this.loading.set(false);
      }
    }
  }

  private async loadScanHistory(projectId: string, revision: number): Promise<void> {
    this.scanLoading.set(true);
    try {
      const [history, latest] = await Promise.all([
        this.scanService.getHistory(projectId),
        this.scanService.getLatest(projectId),
      ]);
      if (revision !== this.projectLoadRevision || this.project()?.id !== projectId) {
        return;
      }
      this.scanHistory.set(history);
      this.latestScan.set(latest);
    } catch (error) {
      if (revision === this.projectLoadRevision && this.project()?.id === projectId) {
        this.actionError.set(toUserMessage(error, 'RepoLens could not load scan history.'));
      }
    } finally {
      if (revision === this.projectLoadRevision) {
        this.scanLoading.set(false);
      }
    }
  }
}
