import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc/register-ipc.js';
import { buildContentSecurityPolicy } from './security/content-security-policy.js';
import {
  assertTrustedIpcInvocation,
  isTrustedRendererUrl,
  type RendererTrustPolicy,
} from './security/sender-validation.js';
import { createAppInfo } from './services/app-info.service.js';

let activeWindow: BrowserWindow | null = null;

interface RendererTarget {
  readonly developmentUrl: URL | null;
  readonly filePath: string;
  readonly trustPolicy: RendererTrustPolicy;
}

function createRendererTarget(): RendererTarget {
  const filePath = join(__dirname, '../renderer/browser/index.html');
  const configuredUrl = app.isPackaged ? undefined : process.env['REPOLENS_RENDERER_URL'];
  const developmentUrl = configuredUrl ? new URL(configuredUrl) : null;

  if (developmentUrl !== null) {
    const isLoopbackHost =
      developmentUrl.hostname === 'localhost' || developmentUrl.hostname === '127.0.0.1';
    const isAllowed =
      developmentUrl.protocol === 'http:' &&
      developmentUrl.port === '4200' &&
      developmentUrl.pathname === '/' &&
      developmentUrl.username === '' &&
      developmentUrl.password === '' &&
      isLoopbackHost;

    if (!isAllowed) {
      throw new Error('REPOLENS_RENDERER_URL must be the local Angular origin on port 4200.');
    }
  }

  const trustPolicy: RendererTrustPolicy =
    developmentUrl === null
      ? { mode: 'file', filePath }
      : { mode: 'development', origin: developmentUrl.origin };

  return { developmentUrl, filePath, trustPolicy };
}

function installContentSecurityPolicy(development: boolean): void {
  const contentSecurityPolicy = buildContentSecurityPolicy(development);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({});
      return;
    }

    const responseHeaders = { ...(details.responseHeaders ?? {}) };
    for (const headerName of Object.keys(responseHeaders)) {
      if (headerName.toLowerCase() === 'content-security-policy') {
        delete responseHeaders[headerName];
      }
    }
    responseHeaders['Content-Security-Policy'] = [contentSecurityPolicy];
    callback({ responseHeaders });
  });
}

async function createMainWindow(target: RendererTarget): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  activeWindow = mainWindow;
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (!isTrustedRendererUrl(destination, target.trustPolicy)) {
      event.preventDefault();
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    if (activeWindow === mainWindow) {
      activeWindow = null;
    }
  });

  if (target.developmentUrl === null) {
    await mainWindow.loadFile(target.filePath);
  } else {
    await mainWindow.loadURL(target.developmentUrl.href);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void app
  .whenReady()
  .then(async () => {
    const rendererTarget = createRendererTarget();
    const appInfo = createAppInfo({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    });

    installContentSecurityPolicy(rendererTarget.developmentUrl !== null);
    registerIpcHandlers(ipcMain, appInfo, (event) => {
      assertTrustedIpcInvocation(
        event.senderFrame?.url ?? null,
        event.sender.mainFrame?.url ?? null,
        rendererTarget.trustPolicy,
      );
    });

    await createMainWindow(rendererTarget);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow(rendererTarget).catch((error: unknown) => {
          console.error('Could not re-open the RepoLens window.', error);
        });
      }
    });
  })
  .catch((error: unknown) => {
    console.error('RepoLens desktop failed to initialize.', error);
    app.exit(1);
  });
