import * as vscode from 'vscode';
import { state } from '../state';
import type { AdoBuild, AdoPipeline } from '../api/types';
import { buildFolderTree, navigateTo, type FolderNode } from '../util/folderTree';
import { buildIcon, describeBuild } from '../util/icons';

type Node = FolderItem | PipelineItem;

class FolderItem extends vscode.TreeItem {
  contextValue = 'folder';
  constructor(public node: FolderNode, public segs: string[]) {
    super(node.name || '/', vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = '/' + segs.join('/');
  }
}

class PipelineItem extends vscode.TreeItem {
  contextValue = 'pipeline';
  constructor(public pipeline: AdoPipeline, build: AdoBuild | null) {
    super(pipeline.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = buildIcon(build);
    this.description = build ? describeBuild(build) : undefined;
    this.tooltip = `${pipeline.name}\n${pipeline.folder ?? ''}\n${describeBuild(build)}`;
    this.command = {
      command: 'adoPipelines.selectPipeline',
      title: 'Open',
      arguments: [pipeline],
    };
  }
}

export class PipelinesProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._emitter.event;
  private filterSegs: string[] = [];
  private cache: AdoPipeline[] | null = null;
  private builds = new Map<number, AdoBuild>();
  private buildPollTimer: NodeJS.Timeout | null = null;

  refresh() { this.cache = null; this._emitter.fire(); void this.refreshBuilds(true); }
  setFilter(segs: string[]) { this.filterSegs = segs; this._emitter.fire(); }
  getFilter() { return this.filterSegs.slice(); }
  pipelines() { return this.cache ?? []; }

  getTreeItem(element: Node): vscode.TreeItem { return element; }

  async getChildren(element?: Node): Promise<Node[]> {
    const client = state.client();
    if (!client) return [];
    if (!this.cache) {
      try {
        const r = await client.listPipelines();
        this.cache = r.value;
        void this.refreshBuilds(true);
      } catch (e) {
        vscode.window.showErrorMessage(`ADO: ${(e as Error).message}`);
        return [];
      }
    }
    const tree = buildFolderTree(this.cache);
    const subtree = element instanceof FolderItem
      ? element.node
      : navigateTo(tree, this.filterSegs).node ?? tree;
    if (!subtree) return [];
    const folders = subtree.folders.map((f) => new FolderItem(f, [...this.filterSegs, f.name]));
    const pipes = subtree.pipelines.map((p) => new PipelineItem(p, this.builds.get(p.id) ?? null));
    return [...folders, ...pipes];
  }

  private async refreshBuilds(reschedule: boolean) {
    const client = state.client();
    if (!client || !this.cache || this.cache.length === 0) return;
    try {
      const ids = this.cache.map((p) => p.id);
      const r = await client.listLatestBuildsForDefinitions(ids);
      this.builds.clear();
      for (const b of r.value) this.builds.set(b.definition.id, b);
      this._emitter.fire();
    } catch {
      // swallow background poll errors
    }
    if (reschedule) {
      if (this.buildPollTimer) clearTimeout(this.buildPollTimer);
      const anyLive = [...this.builds.values()].some((b) => b.status === 'inProgress');
      const ms = anyLive ? 10_000 : 60_000;
      this.buildPollTimer = setTimeout(() => this.refreshBuilds(true), ms);
    }
  }

  dispose() {
    if (this.buildPollTimer) clearTimeout(this.buildPollTimer);
  }
}

export function registerPipelinesView(context: vscode.ExtensionContext): PipelinesProvider {
  const provider = new PipelinesProvider();
  const view = vscode.window.createTreeView('adoPipelines.pipelines', { treeDataProvider: provider, showCollapseAll: true });
  context.subscriptions.push(
    view,
    provider,
    vscode.commands.registerCommand('adoPipelines.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('adoPipelines.filterByPath', async () => {
      const current = '/' + provider.getFilter().join('/');
      const v = await vscode.window.showInputBox({
        prompt: 'Filter pipelines by folder path',
        value: current,
        placeHolder: '/Devops/InfraAcCode/Cloud',
      });
      if (v === undefined) return;
      const segs = v.split(/[\\/]/).filter(Boolean);
      provider.setFilter(segs);
    }),
    vscode.commands.registerCommand('adoPipelines.copyPath', async (item: FolderItem) => {
      if (item?.tooltip) await vscode.env.clipboard.writeText(String(item.tooltip));
    }),
    vscode.commands.registerCommand('adoPipelines.selectPipeline', (p: AdoPipeline) => {
      state.setPipeline({ id: p.id, name: p.name, folder: p.folder });
    }),
  );
  context.subscriptions.push(state.onDidChange(() => provider.refresh()));
  return provider;
}
