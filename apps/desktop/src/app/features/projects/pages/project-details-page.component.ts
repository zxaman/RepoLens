import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DEFAULT_SCAN_CONFIG,
  scanConfigSchema,
  type AnalysisPhase,
  type AnalysisProgress,
  type AnalysisResult,
  type GraphBuildProgress,
  type GraphCycleReport,
  type GraphGenerationReport,
  type GraphSummary,
  type Project,
  type ScanConfig,
  type ScanFile,
  type ScanHistoryItem,
  type ScanPhase,
  type ScanProgress,
  type ScanResult,
} from '@repolens/shared';
import { AnalysisService } from '../services/analysis.service';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import { GraphVisualizationComponent } from '../components/graph-visualization.component';
import { GraphService } from '../services/graph.service';
import { ProjectService, toUserMessage } from '../services/project.service';
import { ScanService } from '../services/scan.service';
import { SettingsService } from '../../settings/settings.service';

@Component({
  selector: 'app-project-details-page',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmRemoveDialogComponent, GraphVisualizationComponent],
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
  readonly currentAnalysis = signal<AnalysisResult | null>(null);
  readonly analysisProgress = signal<AnalysisProgress | null>(null);
  readonly analyzing = signal(false);
  readonly analysisProjectId = signal<string | null>(null);
  readonly activeAnalysisId = signal<string | null>(null);
  readonly cancellingAnalysis = signal(false);
  readonly analysisError = signal('');
  readonly graphReport = signal<GraphGenerationReport | null>(null);
  readonly graphSummary = signal<GraphSummary | null>(null);
  readonly graphCycles = signal<GraphCycleReport | null>(null);
  readonly graphProgress = signal<GraphBuildProgress | null>(null);
  readonly graphError = signal('');
  readonly generatingGraph = signal(false);
  readonly symbolSearch = signal('');
  readonly visibleSymbols = computed(() => {
    const result = this.currentAnalysis();
    const query = this.symbolSearch().trim().toLowerCase();
    const matched = (result?.symbols ?? []).filter(
      (symbol) =>
        query.length === 0 ||
        symbol.name.toLowerCase().includes(query) ||
        symbol.kind.includes(query) ||
        symbol.location.filePath.toLowerCase().includes(query),
    );
    return { items: matched.slice(0, 200), total: matched.length };
  });
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
  readonly defaultExcludedPatterns = DEFAULT_SCAN_CONFIG.excludePatterns;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectService = inject(ProjectService);
  private readonly scanService = inject(ScanService);
  private readonly analysisService = inject(AnalysisService);
  private readonly graphService = inject(GraphService);
  private readonly settingsService = inject(SettingsService);
  private projectLoadRevision = 0;
  private unsubscribeFromProgress: (() => void) | null = null;
  private unsubscribeFromAnalysisProgress: (() => void) | null = null;
  private unsubscribeFromGraphProgress: (() => void) | null = null;
  private readonly abandonedAnalysisRequests = new Set<string>();
  private analysisRunRevision = 0;
  private graphRunRevision = 0;
  private destroyed = false;

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
    try {
      this.unsubscribeFromAnalysisProgress = this.analysisService.onProgress((progress) => {
        const requestKey = this.analysisRequestKey(progress.projectId, progress.scanId);
        if (this.abandonedAnalysisRequests.delete(requestKey)) {
          void this.analysisService.cancel(progress.analysisId).catch(() => undefined);
          this.cleanupAnalysisProgressSubscription();
          return;
        }
        if (
          progress.projectId !== this.analysisProjectId() ||
          progress.scanId !== this.currentScan()?.id
        ) {
          return;
        }
        this.activeAnalysisId.set(progress.analysisId);
        this.analysisProgress.set(progress);
      });
    } catch {
      // Static analysis is desktop-only; the rest of the project details page remains available.
    }
    try {
      this.unsubscribeFromGraphProgress = this.graphService.onProgress((progress) => {
        if (
          progress.projectId !== this.project()?.id ||
          progress.scanId !== this.currentScan()?.id ||
          progress.analysisId !== this.currentAnalysis()?.analysisId
        ) {
          return;
        }
        this.graphProgress.set(progress);
      });
    } catch {
      // Graph generation is desktop-only; analysis results remain available without the bridge.
    }
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.unsubscribeFromProgress?.();
      this.unsubscribeFromGraphProgress?.();
      const analysisId = this.activeAnalysisId();
      if (analysisId !== null) {
        void this.analysisService.cancel(analysisId).catch(() => undefined);
      } else if (this.analyzing()) {
        this.rememberAbandonedAnalysisRequest();
      }
      this.analysisRunRevision += 1;
      this.graphRunRevision += 1;
      this.analyzing.set(false);
      this.generatingGraph.set(false);
      this.cleanupAnalysisProgressSubscription();
    });

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
      this.analyzing() ||
      this.generatingGraph() ||
      (this.includeSensitiveFiles() && !this.acknowledgeSensitiveFileRisk())
    ) {
      return;
    }

    this.actionError.set('');
    this.scanError.set('');
    this.scanProgress.set(null);
    this.activeScanId.set(null);
    this.currentScan.set(null);
    this.currentAnalysis.set(null);
    this.analysisProgress.set(null);
    this.analysisError.set('');
    this.clearGraphState();
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

  async startAnalysis(): Promise<void> {
    const current = this.project();
    const scan = this.currentScan();
    if (
      current === null ||
      scan === null ||
      current.status !== 'registered' ||
      scan.status === 'failed' ||
      this.scanning() ||
      this.analyzing() ||
      this.generatingGraph()
    ) {
      return;
    }

    const revision = ++this.analysisRunRevision;
    this.analysisError.set('');
    this.currentAnalysis.set(null);
    this.analysisProgress.set(null);
    this.clearGraphState();
    this.activeAnalysisId.set(null);
    this.analysisProjectId.set(current.id);
    this.analyzing.set(true);
    try {
      const result = await this.analysisService.start(current.id, scan.id);
      if (
        revision !== this.analysisRunRevision ||
        this.project()?.id !== current.id ||
        this.currentScan()?.id !== scan.id
      ) {
        if (this.abandonedAnalysisRequests.delete(this.analysisRequestKey(current.id, scan.id))) {
          void this.analysisService.cancel(result.analysisId).catch(() => undefined);
        }
        this.cleanupAnalysisProgressSubscription();
        return;
      }
      this.currentAnalysis.set(result);
      if (result.status === 'failed') {
        this.analysisError.set(
          result.diagnostics[0]?.message ?? 'RepoLens could not analyze this scan result.',
        );
      }
    } catch (error) {
      if (revision === this.analysisRunRevision && this.project()?.id === current.id) {
        this.analysisError.set(
          toUserMessage(error, 'RepoLens could not complete static analysis.'),
        );
      } else if (
        this.abandonedAnalysisRequests.delete(this.analysisRequestKey(current.id, scan.id))
      ) {
        this.cleanupAnalysisProgressSubscription();
      }
    } finally {
      if (revision === this.analysisRunRevision) {
        this.analyzing.set(false);
        this.cancellingAnalysis.set(false);
        this.analysisProjectId.set(null);
        this.activeAnalysisId.set(null);
      }
    }
  }

  async cancelAnalysis(): Promise<void> {
    const analysisId = this.activeAnalysisId();
    if (analysisId === null || !this.analyzing() || this.cancellingAnalysis()) {
      return;
    }
    this.cancellingAnalysis.set(true);
    this.analysisError.set('');
    try {
      await this.analysisService.cancel(analysisId);
    } catch (error) {
      this.analysisError.set(toUserMessage(error, 'RepoLens could not cancel static analysis.'));
      this.cancellingAnalysis.set(false);
    }
  }

  async generateGraph(): Promise<void> {
    const current = this.project();
    const scan = this.currentScan();
    const analysis = this.currentAnalysis();
    if (
      current === null ||
      scan === null ||
      analysis === null ||
      current.status !== 'registered' ||
      scan.status !== 'completed' ||
      (analysis.status !== 'completed' && analysis.status !== 'partial') ||
      analysis.filesAnalyzed === 0 ||
      this.scanning() ||
      this.analyzing() ||
      this.generatingGraph()
    ) {
      return;
    }

    const revision = ++this.graphRunRevision;
    this.graphError.set('');
    this.graphReport.set(null);
    this.graphSummary.set(null);
    this.graphCycles.set(null);
    this.graphProgress.set(null);
    this.generatingGraph.set(true);
    try {
      const report = await this.graphService.generate(current.id, scan.id, analysis.analysisId);
      if (
        revision !== this.graphRunRevision ||
        this.destroyed ||
        this.project()?.id !== current.id ||
        this.currentScan()?.id !== scan.id ||
        this.currentAnalysis()?.analysisId !== analysis.analysisId
      ) {
        return;
      }
      this.graphReport.set(report);
      if (report.status === 'failed') {
        return;
      }

      const [summary, cycles] = await Promise.all([
        this.graphService.summary(current.id),
        this.graphService.cycles(current.id),
      ]);
      if (
        revision !== this.graphRunRevision ||
        this.destroyed ||
        this.project()?.id !== current.id ||
        this.currentScan()?.id !== scan.id ||
        this.currentAnalysis()?.analysisId !== analysis.analysisId
      ) {
        return;
      }
      if (
        summary === null ||
        cycles === null ||
        summary.scanId !== scan.id ||
        summary.analysisId !== analysis.analysisId
      ) {
        throw new Error('RepoLens generated the graph but could not retrieve its validated data.');
      }
      this.graphSummary.set(summary);
      this.graphCycles.set(cycles);
    } catch (error) {
      if (revision === this.graphRunRevision && !this.destroyed) {
        this.graphError.set(toUserMessage(error, 'RepoLens could not generate this graph.'));
      }
    } finally {
      if (revision === this.graphRunRevision) {
        this.generatingGraph.set(false);
      }
    }
  }

  graphPhaseLabel(phase: GraphBuildProgress['phase']): string {
    const labels: Record<GraphBuildProgress['phase'], string> = {
      preparing: 'Validating analysis and preparing graph data',
      nodes: 'Building graph nodes',
      edges: 'Building graph relationships',
      metrics: 'Calculating graph metrics and cycles',
      cancelled: 'Graph generation cancelled',
    };
    return labels[phase];
  }

  analysisPhaseLabel(phase: AnalysisPhase): string {
    const labels: Record<AnalysisPhase, string> = {
      initializing: 'Preparing static analysis',
      reading: 'Reading scanned source files',
      parsing: 'Parsing TypeScript and JavaScript syntax',
      resolving: 'Classifying module relationships',
      finalizing: 'Finalizing analysis results',
    };
    return labels[phase];
  }

  analysisProgressPercent(progress: AnalysisProgress): number | null {
    if (progress.percentage !== undefined) {
      return progress.percentage;
    }
    return progress.filesTotal === 0
      ? null
      : Math.round((progress.filesProcessed / progress.filesTotal) * 100);
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

  formatDuration(durationMs: number): string {
    if (durationMs < 1_000) {
      return `${durationMs} ms`;
    }
    const totalSeconds = durationMs / 1_000;
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)} s`;
    }
    return `${Math.floor(totalSeconds / 60)}m ${Math.floor(totalSeconds % 60)}s`;
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
    if (current === null || this.generatingGraph()) {
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

  private clearGraphState(): void {
    this.graphRunRevision += 1;
    this.generatingGraph.set(false);
    this.graphReport.set(null);
    this.graphSummary.set(null);
    this.graphCycles.set(null);
    this.graphProgress.set(null);
    this.graphError.set('');
  }

  private stopGraphForProjectChange(): void {
    this.clearGraphState();
  }

  private stopAnalysisForProjectChange(): void {
    this.analysisRunRevision += 1;
    const analysisId = this.activeAnalysisId();
    if (analysisId !== null) {
      void this.analysisService.cancel(analysisId).catch(() => undefined);
    } else if (this.analyzing()) {
      this.rememberAbandonedAnalysisRequest();
    }
    this.analyzing.set(false);
    this.cancellingAnalysis.set(false);
    this.analysisProjectId.set(null);
    this.activeAnalysisId.set(null);
    this.analysisProgress.set(null);
  }

  private rememberAbandonedAnalysisRequest(): void {
    const projectId = this.analysisProjectId();
    const scanId = this.currentScan()?.id;
    if (projectId !== null && scanId !== undefined) {
      this.abandonedAnalysisRequests.add(this.analysisRequestKey(projectId, scanId));
    }
  }

  private analysisRequestKey(projectId: string, scanId: string): string {
    return `${projectId}:${scanId}`;
  }

  private cleanupAnalysisProgressSubscription(): void {
    if (this.destroyed && this.abandonedAnalysisRequests.size === 0) {
      this.unsubscribeFromAnalysisProgress?.();
      this.unsubscribeFromAnalysisProgress = null;
    }
  }

  private async loadProject(projectId: string | null): Promise<void> {
    const revision = ++this.projectLoadRevision;
    this.stopAnalysisForProjectChange();
    this.stopGraphForProjectChange();
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
    this.currentAnalysis.set(null);
    this.analysisProgress.set(null);
    this.analysisError.set('');
    this.symbolSearch.set('');
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
