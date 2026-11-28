import {
  failureResult,
  successResult,
  type AppError,
  type Project,
  type ProjectImportCommitResult,
  type ProjectImportResult,
  type Result,
} from '@repolens/shared';
import type { IpcMain } from 'electron';
import { toProjectOperationError } from '../services/project-errors.js';
import type { AnalysisManagementService } from '../services/analysis-management.service.js';
import type { ProjectManagementService } from '../services/project-management.service.js';
import type { ScanManagementService } from '../services/scan-management.service.js';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import {
  invalidPayloadAsResult,
  noPayloadSchema,
  registerValidatedHandler,
  type IpcSenderGuard,
} from './register-handler.js';
import { projectIdPayloadSchema, selectionIdPayloadSchema } from './validation.js';

export function registerProjectIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  projects: ProjectManagementService,
  scans: ScanManagementService,
  analyses: AnalysisManagementService,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsImportFolder,
    senderGuard,
    noPayloadSchema(),
    () => safely('folder import', () => projects.importFolder()),
    invalidPayloadAsResult<ProjectImportResult>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsConfirmImport,
    senderGuard,
    selectionIdPayloadSchema,
    ({ selectionId }) => safely('project registration', () => projects.confirmImport(selectionId)),
    invalidPayloadAsResult<ProjectImportCommitResult>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsCancelImport,
    senderGuard,
    selectionIdPayloadSchema,
    ({ selectionId }) => safely('cancel folder import', () => projects.cancelImport(selectionId)),
    invalidPayloadAsResult<{ readonly cancelled: true }>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsList,
    senderGuard,
    noPayloadSchema(),
    () => safely('list projects', () => projects.list()),
    invalidPayloadAsResult<readonly Project[]>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsGetById,
    senderGuard,
    projectIdPayloadSchema,
    ({ id }) => safely('get project', () => projects.getById(id)),
    invalidPayloadAsResult<Project | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsGetActive,
    senderGuard,
    noPayloadSchema(),
    () => safely('get active project', () => projects.getActive()),
    invalidPayloadAsResult<Project | null>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsSetActive,
    senderGuard,
    projectIdPayloadSchema,
    ({ id }) => safely('open project', () => projects.setActive(id)),
    invalidPayloadAsResult<Project>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsRemove,
    senderGuard,
    projectIdPayloadSchema,
    ({ id }) =>
      safely('remove project', () =>
        analyses.removeProject(id, () => scans.removeProject(id, () => projects.remove(id))),
      ),
    invalidPayloadAsResult<{ readonly removed: true }>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.projectsRefresh,
    senderGuard,
    projectIdPayloadSchema,
    ({ id }) => safely('refresh project metadata', () => projects.refresh(id)),
    invalidPayloadAsResult<Project>(),
  );
}

async function safely<T>(operation: string, action: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return successResult(await action());
  } catch (error) {
    const appError: AppError = toProjectOperationError(error, operation);
    return failureResult(appError.code, appError.message);
  }
}
