import * as vscode from 'vscode';
import { state } from './state';
import type { AdoArtifact, AdoBuild, AdoPipeline, AdoPipelineDetail, AdoRun, AdoRunDetail, TimelineResponse } from './api/types';
import type { PipelinesProvider } from './views/pipelinesView';

let pipelineOverviewPanel: vscode.WebviewPanel | undefined;
let runOverviewPanel: vscode.WebviewPanel | undefined;

export function registerExtras(context: vscode.ExtensionContext, pipelines: PipelinesProvider) {
  context.subscriptions.push(
    // Settings shortcut.
    vscode.commands.registerCommand('adoPipelines.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:powers-hell.ado-pipeline-manager');
    }),

    // Cancel run via ADO build PATCH (build api).
    vscode.commands.registerCommand('adoPipelines.cancelRun', async (item: { run: { id: number } } | { run?: { id: number } }) => {
      const runId = (item as { run?: { id: number } }).run?.id ?? state.run()?.id;
      const client = state.client();
      if (!client || !runId) return;
      const ok = await vscode.window.showWarningMessage(`Cancel run #${runId}?`, { modal: true }, 'Cancel run');
      if (ok !== 'Cancel run') return;
      try {
        // PATCH /build/builds/{id}?api-version=7.1 with { status: 'cancelling' }.
        const token = await (await import('./auth')).getAccessToken({ createIfNone: false });
        if (!token) throw new Error('Not signed in');
        const cfg = vscode.workspace.getConfiguration('adoPipelines');
        const url = `https://dev.azure.com/${encodeURIComponent(cfg.get<string>('org')!)}/${encodeURIComponent(cfg.get<string>('project')!)}/_apis/build/builds/${runId}?api-version=7.1`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ status: 'cancelling' }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        vscode.window.showInformationMessage(`Cancelled #${runId}.`);
        await vscode.commands.executeCommand('adoPipelines.refresh');
      } catch (e) {
        vscode.window.showErrorMessage(`Cancel failed: ${(e as Error).message}`);
      }
    }),

    // Run overview as webview.
    vscode.commands.registerCommand('adoPipelines.openRunOverview', async (item?: { run?: { id: number; name?: string } }) => {
      const runId = item?.run?.id ?? state.run()?.id;
      if (!runId) return;
      const pipeline = state.pipeline();
      if (!pipeline) return;
      const client = state.client();
      if (!client) return;
      const title = `Run ${item?.run?.name ?? '#' + runId}`;
      if (!runOverviewPanel) {
        runOverviewPanel = vscode.window.createWebviewPanel('adoRunOverview', title, vscode.ViewColumn.Active, { enableScripts: false, enableCommandUris: true });
        runOverviewPanel.onDidDispose(() => { runOverviewPanel = undefined; });
      } else {
        runOverviewPanel.title = title;
        runOverviewPanel.reveal(undefined, true);
      }
      const panel = runOverviewPanel;
      panel.webview.html = renderLoading(title);
      try {
        const [run, build, artifacts, timeline] = await Promise.all([
          client.getRun(pipeline.id, runId),
          client.getBuild(runId),
          client.listArtifacts(runId).catch(() => ({ count: 0, value: [] as AdoArtifact[] })),
          client.getTimeline(runId).catch(() => ({ records: [] }) as TimelineResponse),
        ]);
        panel.webview.html = renderRunOverview(client.webUrlForBuild(runId), run, build, artifacts.value, timeline);
      } catch (e) {
        panel.webview.html = renderError(title, (e as Error).message);
      }
    }),

    // Pipeline overview as webview (latest run, recent runs, repo/yaml).
    vscode.commands.registerCommand('adoPipelines.openPipelineOverview', async (arg?: AdoPipeline | { pipeline?: AdoPipeline }) => {
      const argPipeline = (arg as AdoPipeline | undefined)?.id !== undefined
        ? (arg as AdoPipeline)
        : (arg as { pipeline?: AdoPipeline } | undefined)?.pipeline;
      const sel = state.pipeline();
      const pipelineId = argPipeline?.id ?? sel?.id;
      const pipelineName = argPipeline?.name ?? sel?.name ?? `#${pipelineId}`;
      if (!pipelineId) return;
      const client = state.client();
      if (!client) return;
      const title = `Pipeline · ${pipelineName}`;
      if (!pipelineOverviewPanel) {
        pipelineOverviewPanel = vscode.window.createWebviewPanel('adoPipelineOverview', title, vscode.ViewColumn.Active, { enableScripts: false, enableCommandUris: true });
        pipelineOverviewPanel.onDidDispose(() => { pipelineOverviewPanel = undefined; });
      } else {
        pipelineOverviewPanel.title = title;
        pipelineOverviewPanel.reveal(undefined, true);
      }
      const panel = pipelineOverviewPanel;
      panel.webview.html = renderLoading(title);
      try {
        const [detail, runs, latestRes] = await Promise.all([
          client.getPipeline(pipelineId).catch(() => null as AdoPipelineDetail | null),
          client.listRuns(pipelineId).catch(() => ({ count: 0, value: [] as AdoRun[] })),
          client.listLatestBuildsForDefinitions([pipelineId]).catch(() => ({ count: 0, value: [] as AdoBuild[] })),
        ]);
        const latest = latestRes.value[0] ?? null;
        panel.webview.html = renderPipelineOverview(pipelineId, pipelineName, detail, runs.value.slice(0, 20), latest, client);
      } catch (e) {
        panel.webview.html = renderError(title, (e as Error).message);
      }
    }),

    // Auto-open pipeline overview when a pipeline is selected (configurable).
    state.onDidChange(() => {
      if (!vscode.workspace.getConfiguration('adoPipelines').get<boolean>('openOverviewOnSelect', true)) return;
      const p = state.pipeline();
      if (!p) return;
      if (lastOverviewPipelineId === p.id) return;
      lastOverviewPipelineId = p.id;
      void vscode.commands.executeCommand('adoPipelines.openPipelineOverview', { id: p.id, name: p.name, folder: p.folder });
    }),

    // Pipeline command palette: QuickPick across all pipelines.
    vscode.commands.registerCommand('adoPipelines.commandPalette', async () => {
      const items = pipelines.pipelines();
      if (items.length === 0) {
        vscode.window.showInformationMessage('No pipelines loaded yet. Open the ADO Pipelines view first.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        items.map((p) => ({
          label: `$(rocket) ${p.name}`,
          description: p.folder ?? '',
          pipeline: p,
        })) as (vscode.QuickPickItem & { pipeline: AdoPipeline })[],
        { placeHolder: 'Pipeline command palette — pick a pipeline', matchOnDescription: true },
      );
      if (!pick) return;
      state.setPipeline({ id: pick.pipeline.id, name: pick.pipeline.name, folder: pick.pipeline.folder });
      const action = await vscode.window.showQuickPick(
        ['$(eye) Show recent runs', '$(play) Run pipeline…', '$(edit) Edit pipeline YAML…'],
        { placeHolder: pick.pipeline.name },
      );
      if (!action) return;
      if (action.includes('Run pipeline')) await vscode.commands.executeCommand('adoPipelines.runPipeline', pick.pipeline);
      else if (action.includes('Edit pipeline')) await vscode.commands.executeCommand('adoPipelines.editPipeline', pick.pipeline);
      // 'Show recent runs' is just the side-effect of state.setPipeline above.
    }),
  );
}

let lastOverviewPipelineId: number | null = null;

function esc(s: string | undefined | null): string {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function shortBranch(ref?: string): string {
  if (!ref) return '';
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, 'tag:');
}

function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  let s = Math.max(0, Math.round((end - start) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

type StatusKind = 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled' | 'pending' | 'unknown';

function statusKind(state?: string, result?: string): StatusKind {
  if (state === 'inProgress' || state === 'cancelling' || state === 'canceling' || state === 'notStarted') return 'running';
  if (state === 'pending') return 'pending';
  switch (result) {
    case 'succeeded': return 'succeeded';
    case 'partiallySucceeded': return 'partial';
    case 'failed': return 'failed';
    case 'canceled': return 'canceled';
    default: return 'unknown';
  }
}

function statusPill(state?: string, result?: string): string {
  const k = statusKind(state, result);
  const label = ({
    running: state === 'cancelling' || state === 'canceling' ? 'Cancelling' : 'Running',
    succeeded: 'Succeeded',
    partial: 'Partially succeeded',
    failed: 'Failed',
    canceled: 'Canceled',
    pending: 'Pending',
    unknown: result || state || 'unknown',
  } as Record<StatusKind, string>)[k];
  const codicon = ({
    running: 'sync~spin', succeeded: 'pass-filled', partial: 'warning',
    failed: 'error', canceled: 'circle-slash', pending: 'circle-outline', unknown: 'circle-outline',
  } as Record<StatusKind, string>)[k];
  return `<span class="pill pill-${k}" title="${esc(label)}"><span class="dot"></span>${esc(label)}<span class="codicon-hint">${esc(codicon)}</span></span>`;
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 24px; line-height: 1.5; }
  a { color: var(--vscode-textLink-foreground); }
  a:hover { color: var(--vscode-textLink-activeForeground); }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 4px 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  h2 { font-size: 1.05rem; font-weight: 600; margin: 28px 0 10px 0; opacity: .85; text-transform: uppercase; letter-spacing: .05em; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 16px 0; font-size: .9rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .card { background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent)); border-radius: 6px; padding: 12px 14px; }
  .card .label { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .card .value { font-size: .95rem; word-break: break-word; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: .8rem; font-weight: 500; border: 1px solid transparent; }
  .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 20%, transparent); }
  .pill .codicon-hint { display: none; }
  .pill-running { color: var(--vscode-charts-blue); background: color-mix(in srgb, var(--vscode-charts-blue) 15%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-blue) 40%, transparent); }
  .pill-succeeded { color: var(--vscode-charts-green); background: color-mix(in srgb, var(--vscode-charts-green) 15%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-green) 40%, transparent); }
  .pill-partial { color: var(--vscode-charts-orange); background: color-mix(in srgb, var(--vscode-charts-orange) 15%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-orange) 40%, transparent); }
  .pill-failed { color: var(--vscode-charts-red); background: color-mix(in srgb, var(--vscode-charts-red) 15%, transparent); border-color: color-mix(in srgb, var(--vscode-charts-red) 40%, transparent); }
  .pill-canceled, .pill-pending, .pill-unknown { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent); border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent); }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 4px; font-size: .8rem; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 0 0; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-decoration: none; font-size: .85rem; }
  .btn:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); color: var(--vscode-button-secondaryForeground); }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(128,128,128,.2))); }
  th { font-weight: 500; color: var(--vscode-descriptionForeground); font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; }
  .summary .stat { display: flex; align-items: baseline; gap: 6px; }
  .summary .num { font-size: 1.4rem; font-weight: 600; }
  .err { color: var(--vscode-errorForeground); padding: 16px; border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 4px; background: var(--vscode-inputValidation-errorBackground); }
`;

function pageShell(title: string, body: string, csp: string): string {
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head><body>${body}</body></html>`;
}

const CSP_DEFAULT = `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https:;`;

function renderLoading(title: string): string {
  return pageShell(title, `<h1>${esc(title)}</h1><p class="sub">Loading…</p>`, CSP_DEFAULT);
}

function renderError(title: string, msg: string): string {
  return pageShell(title, `<h1>${esc(title)}</h1><div class="err">Failed to load: ${esc(msg)}</div>`, CSP_DEFAULT);
}

function renderRunOverview(buildUrl: string, run: AdoRunDetail, build: AdoBuild, artifacts: AdoArtifact[], timeline: TimelineResponse): string {
  const title = run.name || `Run #${run.id}`;
  const start = build.startTime ?? run.createdDate;
  const end = build.finishTime ?? run.finishedDate;
  const isLive = run.state === 'inProgress' || run.state === 'canceling';
  const records = timeline.records ?? [];
  const taskRecs = records.filter((r) => r.type === 'Task');
  const tally = {
    succeeded: taskRecs.filter((r) => r.result === 'succeeded').length,
    failed: taskRecs.filter((r) => r.result === 'failed').length,
    skipped: taskRecs.filter((r) => r.result === 'skipped').length,
    running: taskRecs.filter((r) => r.state === 'inProgress').length,
    pending: taskRecs.filter((r) => r.state === 'pending').length,
  };
  const branch = shortBranch(build.sourceBranch);
  const cancelLink = isLive
    ? `<a class="btn btn-secondary" href="command:adoPipelines.cancelRun">⏹ Cancel run</a>`
    : '';
  const stepsLink = `<a class="btn btn-secondary" href="command:workbench.view.extension.adoPipelines">↗ Open Steps panel</a>`;
  const failedRecs = records.filter((r) => r.type === 'Task' && r.result === 'failed').slice(0, 8);

  const body = `
    <h1>${esc(title)} ${statusPill(run.state, run.result)}</h1>
    <p class="sub">${esc(build.buildNumber || '')}${branch ? ` · <span class="chip">⎇ ${esc(branch)}</span>` : ''}</p>
    <div class="actions">
      <a class="btn" href="${esc(buildUrl)}">↗ Open in Azure DevOps</a>
      ${stepsLink}
      ${cancelLink}
    </div>

    <h2>Summary</h2>
    <div class="grid">
      <div class="card"><div class="label">Build #</div><div class="value">${esc(build.buildNumber)}</div></div>
      <div class="card"><div class="label">Branch</div><div class="value">${esc(branch || '—')}</div></div>
      <div class="card"><div class="label">Duration</div><div class="value">${esc(fmtDuration(start, end))}${isLive ? ' (running)' : ''}</div></div>
      <div class="card"><div class="label">Started</div><div class="value">${esc(fmtDate(start))}</div></div>
      <div class="card"><div class="label">Finished</div><div class="value">${esc(isLive ? '—' : fmtDate(end))}</div></div>
      <div class="card"><div class="label">Run id</div><div class="value">#${run.id}</div></div>
    </div>

    <h2>Tasks (${taskRecs.length})</h2>
    <div class="card summary">
      <div class="stat"><span class="num" style="color:var(--vscode-charts-green)">${tally.succeeded}</span><span>passed</span></div>
      <div class="stat"><span class="num" style="color:var(--vscode-charts-red)">${tally.failed}</span><span>failed</span></div>
      <div class="stat"><span class="num" style="color:var(--vscode-charts-blue)">${tally.running}</span><span>running</span></div>
      <div class="stat"><span class="num" style="color:var(--vscode-descriptionForeground)">${tally.skipped}</span><span>skipped</span></div>
      <div class="stat"><span class="num" style="color:var(--vscode-descriptionForeground)">${tally.pending}</span><span>pending</span></div>
    </div>

    ${failedRecs.length ? `
      <h2>Failed tasks</h2>
      <table><thead><tr><th>Task</th><th>Status</th><th>Duration</th></tr></thead><tbody>
      ${failedRecs.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td>${statusPill(r.state, r.result)}</td>
        <td>${esc(fmtDuration(r.startTime, r.finishTime))}</td>
      </tr>`).join('')}
      </tbody></table>` : ''}

    <h2>Artifacts (${artifacts.length})</h2>
    ${artifacts.length ? `<div class="grid">${artifacts.map((a) => `
      <div class="card">
        <div class="label">Artifact</div>
        <div class="value">📦 ${esc(a.name)}</div>
        ${a.resource?.url ? `<div class="actions"><a class="btn btn-secondary" href="${esc(a.resource.url)}">Download</a></div>` : ''}
      </div>`).join('')}</div>` : `<div class="empty">No artifacts published.</div>`}
  `;
  return pageShell(title, body, CSP_DEFAULT);
}

function renderPipelineOverview(
  pipelineId: number,
  pipelineName: string,
  detail: AdoPipelineDetail | null,
  runs: AdoRun[],
  latest: AdoBuild | null,
  client: { webUrlForBuild: (id: number) => string },
): string {
  const title = pipelineName;
  const folder = detail?.folder ?? '';
  const cfg = detail?.configuration;
  const repoName = cfg?.repository?.name ?? '';
  const yamlPath = cfg?.path ?? '';

  const runRow = (r: AdoRun) => `
    <tr>
      <td><a href="command:adoPipelines.openRunOverview?${encodeURIComponent(JSON.stringify([{ run: { id: r.id, name: r.name } }]))}">${esc(r.name || `#${r.id}`)}</a></td>
      <td>${statusPill(r.state, r.result)}</td>
      <td>${esc(fmtDate(r.createdDate))}</td>
      <td>${esc(fmtDuration(r.createdDate, r.finishedDate))}</td>
    </tr>`;

  const latestPill = latest
    ? statusPill(latest.status, latest.result)
    : `<span class="pill pill-unknown">No runs yet</span>`;

  const runArgs = encodeURIComponent(JSON.stringify([{ id: pipelineId, name: pipelineName, folder }]));
  const editArgs = runArgs;

  const body = `
    <h1>${esc(title)} ${latestPill}</h1>
    <p class="sub">${esc(folder || '/')}${cfg?.type ? ` · <span class="chip">${esc(cfg.type)}</span>` : ''}</p>
    <div class="actions">
      <a class="btn" href="command:adoPipelines.runPipeline?${runArgs}">▶ Run pipeline…</a>
      <a class="btn btn-secondary" href="command:adoPipelines.editPipeline?${editArgs}">✎ Edit YAML</a>
      ${latest ? `<a class="btn btn-secondary" href="${esc(client.webUrlForBuild(latest.id))}">↗ Latest in Azure DevOps</a>` : ''}
    </div>

    <h2>Definition</h2>
    <div class="grid">
      <div class="card"><div class="label">Pipeline id</div><div class="value">#${pipelineId}</div></div>
      <div class="card"><div class="label">Folder</div><div class="value">${esc(folder || '/')}</div></div>
      <div class="card"><div class="label">Repository</div><div class="value">${esc(repoName || '—')}</div></div>
      <div class="card"><div class="label">YAML path</div><div class="value">${esc(yamlPath || '—')}</div></div>
      ${detail?.revision !== undefined ? `<div class="card"><div class="label">Revision</div><div class="value">${esc(String(detail.revision))}</div></div>` : ''}
    </div>

    ${latest ? `
      <h2>Latest run</h2>
      <div class="grid">
        <div class="card"><div class="label">Build #</div><div class="value">${esc(latest.buildNumber)}</div></div>
        <div class="card"><div class="label">Branch</div><div class="value">${esc(shortBranch(latest.sourceBranch) || '—')}</div></div>
        <div class="card"><div class="label">Duration</div><div class="value">${esc(fmtDuration(latest.startTime, latest.finishTime))}</div></div>
        <div class="card"><div class="label">Started</div><div class="value">${esc(fmtDate(latest.startTime))}</div></div>
        <div class="card"><div class="label">Finished</div><div class="value">${esc(latest.status === 'inProgress' ? '—' : fmtDate(latest.finishTime))}</div></div>
      </div>` : ''}

    <h2>Recent runs (${runs.length})</h2>
    ${runs.length ? `<table><thead><tr><th>Run</th><th>Status</th><th>Created</th><th>Duration</th></tr></thead>
      <tbody>${runs.map(runRow).join('')}</tbody></table>` : `<div class="empty">No runs yet for this pipeline.</div>`}
  `;
  return pageShell(title, body, CSP_DEFAULT);
}
