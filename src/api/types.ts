// Mirror of types.ts from the SPA project (ado-pipeline-viewer/src/api/types.ts).
// Keep in sync; copy verbatim and trim DOM-specific fields if any.

export interface AdoPipeline {
  id: number;
  name: string;
  folder?: string;
  revision?: number;
  url?: string;
}

export interface AdoPipelinesResponse { count: number; value: AdoPipeline[] }

export interface AdoRun {
  id: number;
  name?: string;
  state: 'unknown' | 'inProgress' | 'canceling' | 'completed';
  result?: 'unknown' | 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled';
  createdDate?: string;
  finishedDate?: string;
  url?: string;
}
export interface AdoRunsResponse { count: number; value: AdoRun[] }

export interface AdoVariable { value: string; isSecret?: boolean }

export interface AdoRunRepositoryResource {
  refName?: string;
  version?: string;
  repository?: { id?: string; type?: string; name?: string; fullName?: string };
}
export interface AdoRunResources {
  repositories?: Record<string, AdoRunRepositoryResource>;
}
export interface AdoRunDetail extends AdoRun {
  templateParameters?: Record<string, unknown>;
  variables?: Record<string, AdoVariable>;
  resources?: AdoRunResources;
}

export interface AdoPipelineRepository { id: string; type: string; name?: string }
export interface AdoPipelineConfiguration {
  type?: string;
  path?: string;
  repository?: AdoPipelineRepository;
}
export interface AdoPipelineDetail extends AdoPipeline {
  configuration?: AdoPipelineConfiguration;
}

export interface AdoGitRef { name: string; objectId: string }
export interface AdoGitRefsResponse { count: number; value: AdoGitRef[] }

export interface AdoGitChange {
  changeType: 'edit' | 'add' | 'delete';
  item: { path: string };
  newContent?: { content: string; contentType: 'rawtext' | 'base64encoded' };
}
export interface AdoGitCommit { comment: string; changes: AdoGitChange[] }
export interface AdoGitRefUpdate { name: string; oldObjectId: string }
export interface AdoGitPushRequest { commits: AdoGitCommit[]; refUpdates: AdoGitRefUpdate[] }
export interface AdoGitPush { commits: { commitId: string }[]; refUpdates: { name: string; newObjectId: string }[] }

export interface TimelineRecord {
  id: string;
  parentId?: string;
  type: string; // 'Stage' | 'Phase' | 'Job' | 'Task' | 'Checkpoint'
  name: string;
  state?: 'pending' | 'inProgress' | 'completed';
  result?: 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled' | 'skipped';
  startTime?: string;
  finishTime?: string;
  log?: { id: number; url?: string };
  order?: number;
}
export interface TimelineResponse { records: TimelineRecord[] }

export interface AdoLog { id: number; url?: string; lineCount?: number }
export interface AdoLogsResponse { count: number; value: AdoLog[] }

export interface AdoBuild {
  id: number;
  buildNumber: string;
  status?: 'inProgress' | 'completed' | 'cancelling' | 'notStarted';
  result?: 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled';
  startTime?: string;
  finishTime?: string;
  definition: { id: number; name: string };
  sourceBranch?: string;
}

export interface AdoArtifact { id?: number; name: string; resource?: { type?: string; data?: string; url?: string } }
export interface AdoArtifactsResponse { count: number; value: AdoArtifact[] }

export interface AdoCodeCoverageStatistic { label?: string; covered?: number; total?: number; position?: number }
export interface AdoCodeCoverageData { coverageStats?: AdoCodeCoverageStatistic[] }
export interface AdoCodeCoverageResponse { coverageData?: AdoCodeCoverageData[] }
