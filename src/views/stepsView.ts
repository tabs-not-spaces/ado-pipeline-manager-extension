import * as vscode from 'vscode';
import { state } from '../state';
import type { TimelineRecord } from '../api/types';
import { recordIcon } from '../util/icons';

class StepItem extends vscode.TreeItem {
  constructor(public record: TimelineRecord, hasChildren: boolean) {
    super(record.name, hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.iconPath = recordIcon(record);
    this.description = record.type;
    this.contextValue = record.log ? 'step-haslog' : 'step';
    if (record.log) {
      const buildId = state.run()?.id;
      this.command = buildId
        ? { command: 'adoPipelines.openLog', title: 'Open log', arguments: [buildId, record.log.id, record.name] }
        : undefined;
    }
    const dur = record.startTime && record.finishTime
      ? `${Math.round((Date.parse(record.finishTime) - Date.parse(record.startTime)) / 1000)}s` : '';
    this.tooltip = `${record.name}\n${record.type} · ${record.state ?? ''}${record.result ? ' · ' + record.result : ''}${dur ? ' · ' + dur : ''}`;
  }
}

export class StepsProvider implements vscode.TreeDataProvider<StepItem>, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<StepItem | undefined | void>();
  readonly onDidChangeTreeData = this._emitter.event;
  private records: TimelineRecord[] = [];
  private childrenByParent = new Map<string, TimelineRecord[]>();
  private rootIds: string[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private currentRunId: number | null = null;

  refresh() { this._emitter.fire(); }

  getTreeItem(e: StepItem) { return e; }

  async getChildren(element?: StepItem): Promise<StepItem[]> {
    const run = state.run();
    const client = state.client();
    if (!run || !client) { this.stopPoll(); return []; }
    if (this.currentRunId !== run.id) {
      this.currentRunId = run.id;
      this.records = [];
    }
    if (this.records.length === 0 || !element) {
      try {
        const t = await client.getTimeline(run.id);
        this.records = (t.records ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        this.rebuildIndex();
        this.schedulePoll();
      } catch (e) {
        vscode.window.showErrorMessage(`ADO timeline: ${(e as Error).message}`);
        return [];
      }
    }
    const parentId = element?.record.id ?? '';
    const children = parentId
      ? (this.childrenByParent.get(parentId) ?? [])
      : this.rootIds.map((id) => this.records.find((r) => r.id === id)!).filter(Boolean);
    return children.map((r) => new StepItem(r, (this.childrenByParent.get(r.id)?.length ?? 0) > 0));
  }

  private rebuildIndex() {
    this.childrenByParent.clear();
    this.rootIds = [];
    const ids = new Set(this.records.map((r) => r.id));
    for (const r of this.records) {
      if (r.parentId && ids.has(r.parentId)) {
        const arr = this.childrenByParent.get(r.parentId) ?? [];
        arr.push(r);
        this.childrenByParent.set(r.parentId, arr);
      } else {
        this.rootIds.push(r.id);
      }
    }
  }

  private schedulePoll() {
    this.stopPoll();
    const cfg = vscode.workspace.getConfiguration('adoPipelines');
    const anyLive = this.records.some((r) => r.state === 'inProgress');
    const ms = anyLive
      ? cfg.get<number>('timelineRefreshIntervalActiveMs', 2000)
      : cfg.get<number>('timelineRefreshIntervalIdleMs', 10000);
    this.pollTimer = setTimeout(() => {
      this.records = [];
      this.refresh();
    }, ms);
  }
  private stopPoll() {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
  }
  dispose() { this.stopPoll(); }
}

export function registerStepsView(context: vscode.ExtensionContext): StepsProvider {
  const provider = new StepsProvider();
  context.subscriptions.push(
    vscode.window.createTreeView('adoPipelines.steps', { treeDataProvider: provider, showCollapseAll: true }),
    provider,
    state.onDidChange(() => provider.refresh()),
  );
  return provider;
}
