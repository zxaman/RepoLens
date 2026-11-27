import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'welcome' },
  {
    path: 'welcome',
    loadComponent: () =>
      import('./features/projects/pages/welcome-page.component').then(
        (module) => module.WelcomePageComponent,
      ),
  },
  {
    path: 'projects',
    loadComponent: () =>
      import('./features/projects/pages/projects-page.component').then(
        (module) => module.ProjectsPageComponent,
      ),
  },
  {
    path: 'projects/:projectId',
    loadComponent: () =>
      import('./features/projects/pages/project-details-page.component').then(
        (module) => module.ProjectDetailsPageComponent,
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings-page.component').then(
        (module) => module.SettingsPageComponent,
      ),
  },
  { path: '**', redirectTo: 'welcome' },
];
