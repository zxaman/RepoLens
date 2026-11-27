import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { Project } from '@repolens/shared';

@Component({
  selector: 'app-confirm-remove-dialog',
  standalone: true,
  templateUrl: './confirm-remove-dialog.component.html',
  styleUrl: './confirm-remove-dialog.component.scss',
})
export class ConfirmRemoveDialogComponent {
  @Input({ required: true }) project!: Project;
  @Input() busy = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
