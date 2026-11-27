import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppInfoService } from './app-info.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly appVersion = signal('Reading application version…');
  protected readonly bridgeStatus = signal('Checking the secure desktop bridge.');
  private readonly appInfo = inject(AppInfoService);

  ngOnInit(): void {
    void this.loadApplicationVersion();
  }

  private async loadApplicationVersion(): Promise<void> {
    try {
      const version = await this.appInfo.getVersion();
      if (version === null) {
        this.appVersion.set('Unavailable');
        this.bridgeStatus.set(
          'Desktop runtime not detected. Launch RepoLens through Electron to read its version.',
        );
        return;
      }

      this.appVersion.set(version);
      this.bridgeStatus.set('Secure desktop bridge connected.');
    } catch {
      this.appVersion.set('Unavailable');
      this.bridgeStatus.set('Could not retrieve application information from the desktop runtime.');
    }
  }
}
