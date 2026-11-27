import { describe, expect, it } from 'vitest';
import { createCliProgram, getPackageVersion } from './program.js';

async function runCliArguments(
  args: readonly string[],
): Promise<{ output: string; error: unknown }> {
  let output = '';
  const program = createCliProgram();
  program.configureOutput({
    writeOut: (text) => {
      output += text;
    },
    writeErr: (text) => {
      output += text;
    },
  });
  program.exitOverride();

  let error: unknown;
  try {
    await program.parseAsync(['node', 'repolens', ...args]);
  } catch (caughtError: unknown) {
    error = caughtError;
  }

  return { output, error };
}

describe('RepoLens CLI foundation', () => {
  it('prints the version read from the CLI package metadata', async () => {
    const result = await runCliArguments(['--version']);

    expect(result.output).toBe(`${getPackageVersion()}\n`);
    expect(result.error).toMatchObject({ code: 'commander.version' });
  });

  it('prints Commander help without claiming unimplemented commands', async () => {
    const result = await runCliArguments(['--help']);

    expect(result.output).toContain('Usage: repolens [options]');
    expect(result.output).toContain('display help for command');
    expect(result.output).toContain('Analyze once. Understand anywhere.');
    expect(result.error).toMatchObject({ code: 'commander.helpDisplayed' });
  });
});
