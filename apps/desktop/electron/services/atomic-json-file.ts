import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { z } from 'zod';

export async function readValidatedJson<T>(
  filePath: string,
  schema: z.ZodType<T>,
  defaultValue: T,
  description: string,
): Promise<T> {
  let serialized: string;
  try {
    serialized = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    await quarantine(filePath, description, error);
    return defaultValue;
  }

  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  await quarantine(filePath, description, parsed.error);
  return defaultValue;
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const temporaryPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function quarantine(filePath: string, description: string, cause: unknown): Promise<void> {
  const backupPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
  await rename(filePath, backupPath);
  console.error(`RepoLens preserved malformed ${description} at ${backupPath}.`, cause);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
