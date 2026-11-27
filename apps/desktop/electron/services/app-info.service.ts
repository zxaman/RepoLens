import { appInfoSchema, type AppInfo } from '@repolens/shared';

export interface DesktopMetadata {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
}

/** Validates runtime metadata supplied by Electron and its application package metadata. */
export function createAppInfo(metadata: DesktopMetadata): AppInfo {
  return appInfoSchema.parse(metadata);
}
