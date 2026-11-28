import { describe, expect, it } from 'vitest';
import { safeErrorDetails } from './diagnostic-logging.js';

describe('safe error diagnostics', () => {
  it('preserves useful error type/code while redacting quoted absolute paths', () => {
    const error = Object.assign(
      new Error(
        "EACCES: permission denied, open '/Users/Alice/Private Projects/Repo/src/index.ts'",
      ),
      { code: 'EACCES' },
    );

    expect(safeErrorDetails(error)).toEqual({
      name: 'Error',
      code: 'EACCES',
      message: "EACCES: permission denied, open '<path>'",
    });
  });

  it('redacts an unquoted project path and its children while retaining the error context', () => {
    const error = new Error('Could not read /home/alice/PrivateRepo/src/index.ts: access denied');

    expect(safeErrorDetails(error, ['/home/alice/PrivateRepo'])).toMatchObject({
      name: 'Error',
      message: 'Could not read <project>: access denied',
    });
  });

  it('redacts Windows paths and leaves non-path URLs readable', () => {
    const error = new Error(
      'Read C:\\Users\\Alice\\PrivateRepo\\src\\index.ts; see https://example.test/docs',
    );

    expect(safeErrorDetails(error).message).toBe('Read <path>; see https://example.test/docs');
  });

  it('does not serialize arbitrary thrown values or control characters', () => {
    expect(safeErrorDetails({ secret: 'never log me' })).toEqual({
      name: 'UnknownError',
      message: 'A non-Error value was thrown.',
    });
    expect(safeErrorDetails(new Error('first line\nsecond line')).message).toBe(
      'first line second line',
    );
  });
});
