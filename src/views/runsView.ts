import * as vscode from 'vscode';
import { state } from '../state';
import type { AdoRun } from '../api/types';
import { runIcon } from '../util/icons';

class RunItem extends vscode.TreeItem {
  constructor(public run: AdoRun) {
    super(run.name || `#${run.id}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = runIcon(run);
    this.contextValue = run.state === 'inProgress' || run.state === 'canceling' ? 'run-inProgress' : 'run';
    const when = run.finishedDate ?? run.createdDate;
    this.description = `${run.state}${run.result ? ' · ' + run.result : ''}${when ? ' · ' + new Date(when).toLocaleString() : ''}`;
    this.tooltip = `${run.name ?? '#' + run.id}\n${this.description}`;
    this.command = {
      command: 'adoPipelines.selectRun',
      title: 'Open',
      arguments: [run],
    };
  }
}

export class RunsProvider implements vscode.TreeDataProvider<RunItem>, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<RunItem | undefined | void>();
  readonly onDidChangeTreeData = this._emitter.event;
  private cache: AdoRun[] | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private currentPipelineId: number | null = null;

  refresh() { this.cache = null; this._emitter.fire(); }

  getTreeItem(e: RunItem) { return e; }

  async getChildren(): Promise<RunItem[]> {
    const pipeline = state.pipeline();
    const client = state.client();
    if (!pipeline || !client) {
      this.stopPoll();
      return [];
    }
    if (this.currentPipelineId !== pipeline.id) {
      this.currentPipelineId = pipeline.id;
      this.cache = null;
    }
    if (!this.cache) {
      try {
        const r = await client.listRuns(pipeline.id);
        this.cache = (r.value ?? []).slice(0, 50);
      } catch (e) {
        vscode.window.showErrorMessage(`ADO runs: ${(e as Error).message}`);
        return [];
      }
    }
    this.schedulePoll();
    return this.cache.map((r) => new RunItem(r));
  }

  private schedulePoll() {
    this.stopPoll();
    const anyLive = (this.cache ?? []).some((r) => r.state === 'inProgress' || r.state === 'canceling');
    const ms = anyLive ? 5_000 : 30_000;
    this.pollTimer = setTimeout(() => this.refresh(), ms);
  }
  private stopPoll() {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
  }
  dispose() { this.stopPoll(); }
}

export function registerRunsView(context: vscode.ExtensionContext): RunsProvider {
  const provider = new RunsProvider();
  context.subscriptions.push(
    vscode.window.createTreeView('adoPipelines.runs', { treeDataProvider: provider }),
    provider,
    state.onDidChange(() => provider.refresh()),
    vscode.commands.registerCommand('adoPipelines.selectRun', (run: AdoRun) => {
      state.setRun({ id: run.id, name: run.name || `#${run.id}` });
    }),
  );
  return provider;
}
