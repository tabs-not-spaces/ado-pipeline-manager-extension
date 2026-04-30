import * as vscode from 'vscode';
import { getAccessToken } from '../auth';
import type {
  AdoArtifactsResponse,
  AdoBuild,
  AdoGitPush,
  AdoGitPushRequest,
  AdoGitRefsResponse,
  AdoLogsResponse,
  AdoPipelineDetail,
  AdoPipelinesResponse,
  AdoRun,
  AdoRunDetail,
  AdoRunResources,
  AdoRunsResponse,
  AdoVariable,
  TimelineResponse,
} from './types';

export class AdoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'AdoError';
  }
}

export interface RunPipelineOpts {
  branch?: string;
  templateParameters?: Record<string, unknown>;
  variables?: Record<string, AdoVariable>;
  resources?: AdoRunResources;
  stagesToSkip?: string[];
}

export class AdoClient {
  private base: string;
  constructor(public org: string, public project: string) {
    this.base = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
  }

  static fromConfig(): AdoClient | null {
    const cfg = vscode.workspace.getConfiguration('adoPipelines');
    const org = cfg.get<string>('org');
    const project = cfg.get<string>('project');
    if (!org || !project) return null;
    return new AdoClient(org, project);
  }

  private async call<T>(path: string, opts: { raw?: boolean; method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const token = await getAccessToken({ createIfNone: false });
    if (!token) throw new AdoError(401, 'Not signed in. Run "ADO: Sign in".');
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts.raw ? 'text/plain' : 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(`${this.base}${path}`, init);
    if (!res.ok) throw new AdoError(res.status, `${res.status} ${res.statusText}`);
    if (opts.raw) return (await res.text()) as unknown as T;
    return (await res.json()) as T;
  }

  baseUrl() { return this.base; }
  webUrlForBuild(buildId: number) {
    return `https://dev.azure.com/${encodeURIComponent(this.org)}/${encodeURIComponent(this.project)}/_build/results?buildId=${buildId}`;
  }

  listPipelines() { return this.call<AdoPipelinesResponse>(`/pipelines?api-version=7.1`); }
  getPipeline(id: number) { return this.call<AdoPipelineDetail>(`/pipelines/${id}?api-version=7.1`); }
  listRuns(pipelineId: number) { return this.call<AdoRunsResponse>(`/pipelines/${pipelineId}/runs?api-version=7.1`); }
  getRun(pipelineId: number, runId: number) { return this.call<AdoRunDetail>(`/pipelines/${pipelineId}/runs/${runId}?api-version=7.1`); }

  runPipeline(pipelineId: number, opts: RunPipelineOpts = {}) {
    const body: Record<string, unknown> = {};
    if (opts.templateParameters && Object.keys(opts.templateParameters).length) body.templateParameters = opts.templateParameters;
    if (opts.variables && Object.keys(opts.variables).length) body.variables = opts.variables;
    if (opts.stagesToSkip && opts.stagesToSkip.length) body.stagesToSkip = opts.stagesToSkip;
    let resources = opts.resources;
    if (opts.branch) {
      const ref = opts.branch.startsWith('refs/') ? opts.branch : `refs/heads/${opts.branch}`;
      resources = {
        ...(resources ?? {}),
        repositories: {
          ...(resources?.repositories ?? {}),
          self: { ...(resources?.repositories?.self ?? {}), refName: ref },
        },
      };
    }
    if (resources) body.resources = resources;
    return this.call<AdoRun>(`/pipelines/${pipelineId}/runs?api-version=7.1`, { method: 'POST', body });
  }

  listGitRefs(repoId: string, filter = 'heads/') {
    return this.call<AdoGitRefsResponse>(
      `/git/repositories/${encodeURIComponent(repoId)}/refs?filter=${encodeURIComponent(filter)}&api-version=7.1`,
    );
  }

  async getGitItemContent(repoId: string, path: string, branch: string): Promise<string> {
    const params = new URLSearchParams({
      path,
      'versionDescriptor.version': branch,
      'versionDescriptor.versionType': 'branch',
      includeContent: 'true',
      download: 'false',
      $format: 'octetStream',
      'api-version': '7.1',
    });
    return this.call<string>(`/git/repositories/${encodeURIComponent(repoId)}/items?${params.toString()}`, { raw: true });
  }

  pushGitChange(repoId: string, push: AdoGitPushRequest) {
    return this.call<AdoGitPush>(
      `/git/repositories/${encodeURIComponent(repoId)}/pushes?api-version=7.1`,
      { method: 'POST', body: push },
    );
  }

  webUrlForBranch(repoId: string, branch: string) {
    const ref = branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
    return `https://dev.azure.com/${encodeURIComponent(this.org)}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(repoId)}?version=GB${encodeURIComponent(ref.replace('refs/heads/', ''))}`;
  }

  webUrlForCreatePr(repoId: string, sourceBranch: string, targetBranch?: string) {
    const params = new URLSearchParams({ sourceRef: sourceBranch });
    if (targetBranch) params.set('targetRef', targetBranch);
    return `https://dev.azure.com/${encodeURIComponent(this.org)}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(repoId)}/pullrequestcreate?${params.toString()}`;
  }

  getBuild(buildId: number) { return this.call<AdoBuild>(`/build/builds/${buildId}?api-version=7.1`); }
  getTimeline(buildId: number) { return this.call<TimelineResponse>(`/build/builds/${buildId}/timeline?api-version=7.1`); }
  listLogs(buildId: number) { return this.call<AdoLogsResponse>(`/build/builds/${buildId}/logs?api-version=7.1`); }
  async getLogChunk(buildId: number, logId: number, fromByte: number): Promise<{ text: string; nextByte: number; appended: boolean }> {
    const token = await getAccessToken({ createIfNone: false });
    if (!token) throw new AdoError(401, 'Not signed in.');
    const url = `${this.base}/build/builds/${buildId}/logs/${logId}?api-version=7.1`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'text/plain',
    };
    if (fromByte > 0) headers['Range'] = `bytes=${fromByte}-`;
    const res = await fetch(url, { headers });
    if (res.status === 416) return { text: '', nextByte: fromByte, appended: false };
    if (!res.ok) throw new AdoError(res.status, `${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);
    if (res.status === 206) return { text, nextByte: fromByte + buf.byteLength, appended: true };
    return { text, nextByte: buf.byteLength, appended: false };
  }
  listArtifacts(buildId: number) { return this.call<AdoArtifactsResponse>(`/build/builds/${buildId}/artifacts?api-version=7.1`); }
  listLatestBuildsForDefinitions(ids: number[]) {
    if (ids.length === 0) return Promise.resolve({ count: 0, value: [] as AdoBuild[] });
    return this.call<{ count: number; value: AdoBuild[] }>(
      `/build/builds?definitions=${encodeURIComponent(ids.join(','))}&maxBuildsPerDefinition=1&queryOrder=finishTimeDescending&api-version=7.1`,
    );
  }
}
