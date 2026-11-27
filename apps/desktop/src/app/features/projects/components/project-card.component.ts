import { DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Project } from '@repolens/shared';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './project-card.component.html',
  styleUrl: './project-card.component.scss',
})
export class ProjectCardComponent {
  @Input({ required: true }) project!: Project;
  @Input() active = false;
  @Input() showRemove = true;
  @Output() removeProject = new EventEmitter<string>();
}
