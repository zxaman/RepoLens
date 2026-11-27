import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rendererUrl = 'http://127.0.0.1:4200/';
const children = new Set();

function spawnNpm(args, env = process.env) {
  const child = spawn(npmCommand, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function runNpm(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnNpm(args);
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`npm ${args.join(' ')} exited with ${signal ?? code}.`));
      }
    });
  });
}

async function waitForRenderer(child, timeoutMilliseconds = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (child.exitCode !== null) {
      throw new Error('The Angular development server exited before becoming ready.');
    }

    try {
      const response = await fetch(rendererUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // The dev server is still starting; retry until the bounded timeout.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(`Angular did not become ready at ${rendererUrl} within 90 seconds.`);
}

function stopChildren() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stopChildren();
  process.exitCode = 130;
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exitCode = 143;
});

try {
  await runNpm(['run', 'build:packages']);
  await runNpm(['run', 'build:electron', '--workspace=@repolens/desktop']);

  const rendererProcess = spawnNpm(['run', 'dev:web', '--workspace=@repolens/desktop']);
  rendererProcess.once('error', (error) => {
    console.error('Could not start the Angular development server.', error);
  });
  await waitForRenderer(rendererProcess);

  const electronProcess = spawnNpm(['run', 'start:electron', '--workspace=@repolens/desktop'], {
    ...process.env,
    REPOLENS_RENDERER_URL: rendererUrl,
  });
  electronProcess.once('error', (error) => {
    console.error('Could not start Electron.', error);
  });
  const exitCode = await new Promise((resolveExit) => {
    electronProcess.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stopChildren();
}
