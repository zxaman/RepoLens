import type { RepoLensAPI } from '@repolens/shared';

declare global {
  interface Window {
    /** Present only when the Angular renderer runs inside the trusted Electron preload. */
    readonly repolens?: RepoLensAPI;
  }
}

export {};
