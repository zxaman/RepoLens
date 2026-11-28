export interface SafeErrorDetails {
  readonly name: string;
  readonly code?: string;
  readonly message: string;
}

const QUOTED_ABSOLUTE_PATH = /(["'`])(?:(?:[A-Z]:[\\/])|\/|\\\\)[^"'`]*\1/gi;
const UNQUOTED_ABSOLUTE_PATH = /(^|[\s("'=])((?:[A-Z]:[\\/]|\/|\\\\)[^\s"'`<>(){};,:]+)/gim;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 500;

/** Return useful error metadata without logging raw stacks, absolute paths, or arbitrary thrown data. */
export function safeErrorDetails(
  error: unknown,
  privatePaths: readonly string[] = [],
): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: 'A non-Error value was thrown.' };
  }

  let message = error.message.replace(
    QUOTED_ABSOLUTE_PATH,
    (_path, quote: string) => `${quote}<path>${quote}`,
  );
  for (const path of privatePaths) {
    if (path.length === 0) {
      continue;
    }
    const variants = new Set([path, path.replaceAll('\\', '/'), path.replaceAll('/', '\\')]);
    for (const variant of variants) {
      const pathAndChildren = new RegExp(
        `${escapeRegExp(variant)}(?:[\\\\/][^\\s"'<>),;:]+)*`,
        'g',
      );
      message = message.replace(pathAndChildren, '<project>');
    }
  }

  message = message
    .replace(UNQUOTED_ABSOLUTE_PATH, (_path, prefix: string) => `${prefix}<path>`)
    .replace(/[\r\n\t]+/g, ' ')
    .replaceAll('\0', ' ')
    .trim();

  const code =
    'code' in error && typeof error.code === 'string' ? error.code.slice(0, 64) : undefined;
  return {
    name: error.name.slice(0, 64) || 'Error',
    ...(code === undefined ? {} : { code }),
    message: (message || 'Error was thrown without a message.').slice(
      0,
      MAX_DIAGNOSTIC_MESSAGE_LENGTH,
    ),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
