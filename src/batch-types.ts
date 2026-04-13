export interface BatchSuccessCacheMetadata {
  hit: true;
  source: 'result-cache';
  cachedAt?: string;
}

export interface BatchSuccessRecord<T = unknown> {
  input: string;
  index: number;
  attempts: number;
  succeededAt: string;
  cache?: BatchSuccessCacheMetadata;
  result: T;
}

export interface BatchFailureRecord {
  input: string;
  index: number;
  command: string;
  errorCode: string;
  message: string;
  retryable: boolean;
  source?: string;
  attempts: number;
  timestamp: string;
  hint?: string;
  exitCode?: number;
}

export interface BatchRunSummary {
  command: string;
  totalItems: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
}

export interface BatchResumeMetadata {
  resumed: true;
  source: string;
  skippedCompleted: number;
  previousSucceeded: number;
  previousFailed: number;
}

export interface BatchCacheSummary {
  policy: 'default' | 'skip-cached' | 'force-refresh' | 'disabled';
  hits: number;
  misses: number;
  writes: number;
}

export interface BatchSnapshotUsage {
  dataset: string;
  source?: string;
  path?: string;
  release?: string;
  fetchedAt?: string;
  staleAfterDays?: number;
  refreshed?: boolean;
  notes?: string;
}

export interface BatchManifest extends BatchRunSummary {
  biocliVersion: string;
  outdir: string;
  inputSource?: string;
  inputFormat?: string;
  key?: string;
  concurrency?: number;
  retries?: number;
  failFast?: boolean;
  maxErrors?: number;
  resume?: BatchResumeMetadata;
  cache?: BatchCacheSummary;
  snapshots?: BatchSnapshotUsage[];
  files: {
    resultsJsonl: string;
    failuresJsonl: string;
    summaryJson: string;
    summaryCsv?: string;
    manifestJson: string;
    methodsMd?: string;
  };
}
