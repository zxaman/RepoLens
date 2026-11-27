import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const cliEntry = fileURLToPath(new URL('../apps/cli/dist/index.js', import.meta.url));
  await chmod(cliEntry, 0o755);
}
