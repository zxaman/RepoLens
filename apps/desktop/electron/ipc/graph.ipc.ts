import {
  failureResult,
  graphBuildProgressSchema,
  graphCycleReportSchema,
  graphGenerationReportSchema,
  graphDisposeResultSchema,
  graphExportJsonSchema,
  graphNodeQueryResultSchema,
  graphPathResultSchema,
  graphSummarySchema,
  graphTraversalResultSchema,
  successResult,
  type AppError,
  type GraphCycleReport,
  type GraphNodeQueryResult,
  type GraphPathResult,
  type GraphGenerationReport,
  type GraphSummary,
  type GraphTraversalResult,
  type Result,
} from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { GraphManagementService } from '../services/graph-management.service.js';
import { toProjectOperationError } from '../services/project-errors.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import {
  graphCyclesPayloadSchema,
  graphDependenciesPayloadSchema,
  graphGeneratePayloadSchema,
  graphPathPayloadSchema,
  graphProjectPayloadSchema,
  graphQueryPayloadSchema,
} from './validation.js';
import {
  invalidPayloadAsResult,
  registerValidatedHandler,
  type IpcSenderGuard,
} from './register-handler.js';

export function registerGraphIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  graphs: GraphManagementService,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsGenerate,
    senderGuard,
    graphGeneratePayloadSchema,
    ({ projectId, scanId, analysisId }, event) =>
      safely('graph generation', async () =>
        graphGenerationReportSchema.parse(
          await graphs.generate(projectId, scanId, analysisId, (progress) =>
            sendGraphProgressToSender(event, progress),
          ),
        ),
      ),
    invalidPayloadAsResult<GraphGenerationReport>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsSummary,
    senderGuard,
    graphProjectPayloadSchema,
    ({ projectId }) =>
      safely('graph summary', async () =>
        graphSummarySchema.nullable().parse(await graphs.summary(projectId)),
      ),
    invalidPayloadAsResult<GraphSummary | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsQuery,
    senderGuard,
    graphQueryPayloadSchema,
    ({ projectId, query }) =>
      safely('graph query', async () =>
        graphNodeQueryResultSchema.nullable().parse(await graphs.query(projectId, query)),
      ),
    invalidPayloadAsResult<GraphNodeQueryResult | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsDependencies,
    senderGuard,
    graphDependenciesPayloadSchema,
    ({ projectId, query }) =>
      safely('graph dependency traversal', async () =>
        graphTraversalResultSchema.nullable().parse(await graphs.dependencies(projectId, query)),
      ),
    invalidPayloadAsResult<GraphTraversalResult | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsShortestPath,
    senderGuard,
    graphPathPayloadSchema,
    ({ projectId, query }) =>
      safely('graph shortest path', async () =>
        graphPathResultSchema.nullable().parse(await graphs.shortestPath(projectId, query)),
      ),
    invalidPayloadAsResult<GraphPathResult | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsCycles,
    senderGuard,
    graphCyclesPayloadSchema,
    ({ projectId, query }) =>
      safely('graph cycle query', async () =>
        graphCycleReportSchema.nullable().parse(await graphs.cycles(projectId, query ?? {})),
      ),
    invalidPayloadAsResult<GraphCycleReport | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsExportJson,
    senderGuard,
    graphProjectPayloadSchema,
    ({ projectId }) =>
      safely('graph JSON export', async () =>
        graphExportJsonSchema.nullable().parse(await graphs.exportJson(projectId)),
      ),
    invalidPayloadAsResult<string | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.graphsDispose,
    senderGuard,
    graphProjectPayloadSchema,
    ({ projectId }) =>
      safely('dispose project graph', async () =>
        graphDisposeResultSchema.parse(await graphs.dispose(projectId)),
      ),
    invalidPayloadAsResult<{ readonly disposed: true }>(),
  );
}

function sendGraphProgressToSender(event: IpcMainInvokeEvent, value: unknown): void {
  const progress = graphBuildProgressSchema.safeParse(value);
  if (!progress.success || event.sender.isDestroyed()) {
    return;
  }
  try {
    event.sender.send(IPC_EVENTS.graphsProgress, progress.data);
  } catch {
    // Closing the renderer must not interrupt graph construction or cleanup.
  }
}

async function safely<T>(operation: string, action: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return successResult(await action());
  } catch (error) {
    const appError: AppError = toProjectOperationError(error, operation);
    return failureResult(appError.code, appError.message);
  }
}
