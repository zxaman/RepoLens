const COMMON_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
] as const;

export function buildContentSecurityPolicy(development: boolean): string {
  const connectSources = development
    ? "connect-src 'self' ws://127.0.0.1:4200 ws://localhost:4200"
    : "connect-src 'self'";

  return [...COMMON_DIRECTIVES, connectSources].join('; ');
}
