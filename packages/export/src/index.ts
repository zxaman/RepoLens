export type ExportFormat = 'bundle' | 'json' | 'docs';

export interface ExportRequest<TData> {
  readonly format: ExportFormat;
  readonly data: TData;
  readonly destinationPath: string;
}

/** Contract for future export implementations; no files are generated in v0.1.0. */
export interface Exporter<TData, TResult> {
  readonly format: ExportFormat;
  export(request: ExportRequest<TData>): Promise<TResult>;
}
