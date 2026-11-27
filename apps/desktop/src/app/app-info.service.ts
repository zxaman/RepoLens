import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppInfoService {
  getVersion(): Promise<string | null> {
    if (typeof window === 'undefined') {
      return Promise.resolve(null);
    }

    const bridge = window.repolens;
    return bridge === undefined ? Promise.resolve(null) : bridge.app.getVersion();
  }
}
