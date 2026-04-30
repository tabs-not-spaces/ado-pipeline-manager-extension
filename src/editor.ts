import * as vscode from 'vscode';
import { state } from './state';
import type { AdoPipelineDetail } from './api/types';

const SCHEME = 'ado-pipeline';

interface DocMeta {
  pipelineId: number;
  pipelineName: string;
  repoId: string;
  path: string;
  branch: string;
  baseObjectId: string;
}

class EditorProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this._emitter.event;
  private docs = new Map<string, { content: string; meta: DocMeta }>();

  uriFor(meta: DocMeta): vscode.Uri {
    const safeName = meta.pipelineName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return vscode.Uri.parse(
      `${SCHEME}:/${safeName}.yml?` +
        new URLSearchParams({
          pipelineId: String(meta.pipelineId),
          pipelineName: meta.pipelineName,
          repoId: meta.repoId,
          path: meta.path,
          branch: meta.branch,
          baseObjectId: meta.baseObjectId,
        }).toString(),
    );
  }

  parse(uri: vscode.Uri): DocMeta | null {
    if (uri.scheme !== SCHEME) return null;
    const q = new URLSearchParams(uri.query);
    const pipelineId = parseInt(q.get('pipelineId') ?? '0', 10);
    if (!pipelineId) return null;
    return {
      pipelineId,
      pipelineName: q.get('pipelineName') ?? '',
      repoId: q.get('repoId') ?? '',
      path: q.get('path') ?? '',
      branch: q.get('branch') ?? '',
      baseObjectId: q.get('baseObjectId') ?? '',
    };
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const cached = this.docs.get(key);
    if (cached) return cached.content;
    const meta = this.parse(uri);
    const client = state.client();
    if (!meta || !client) return '# Failed to load: missing context\n';
    try {
      const content = await client.getGitItemContent(meta.repoId, meta.path, meta.branch);
      this.docs.set(key, { content, meta });
      return content;
    } catch (e) {
      return `# Failed to load: ${(e as Error).message}\n`;
    }
  }

  metaFor(uri: vscode.Uri): DocMeta | null {
    return this.docs.get(uri.toString())?.meta ?? null;
  }

  dispose() { this.docs.clear(); }
}

let provider: EditorProvider | null = null;

export function registerEditorProvider(context: vscode.ExtensionContext) {
  provider = new EditorProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    provider,
    vscode.commands.registerCommand('adoPipelines.editPipeline', async (arg: { pipeline: { id: number; name: string } } | { id: number; name: string }) => {
      const p = ('pipeline' in arg) ? arg.pipeline : arg;
      const client = state.client();
      if (!client) { vscode.window.showErrorMessage('ADO: not configured / not signed in'); return; }
      let detail: AdoPipelineDetail;
      try {
        detail = await client.getPipeline(p.id);
      } catch (e) {
        vscode.window.showErrorMessage(`ADO: ${(e as Error).message}`); return;
      }
      const cfg = detail.configuration;
      if (!cfg?.repository?.id || !cfg.path) {
        vscode.window.showErrorMessage('Pipeline is not YAML-backed by a Git repository.');
        return;
      }
      const branch = await pickBranch(client, cfg.repository.id, 'main');
      if (!branch) return;
      const refs = await client.listGitRefs(cfg.repository.id, `heads/${branch}`).catch(() => null);
      const baseObjectId = refs?.value.find((r) => r.name === `refs/heads/${branch}`)?.objectId ?? '';
      if (!baseObjectId) {
        vscode.window.showErrorMessage(`Could not resolve base commit for ${branch}.`);
        return;
      }
      const meta: DocMeta = {
        pipelineId: p.id,
        pipelineName: p.name,
        repoId: cfg.repository.id,
        path: cfg.path,
        branch,
        baseObjectId,
      };
      const uri = provider!.uriFor(meta);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(
        `Editing ${cfg.path}@${branch}. Use "ADO: Save pipeline to new branch" to push.`,
      );
    }),
    vscode.commands.registerCommand('adoPipelines.savePipelineToBranch', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== SCHEME) {
        vscode.window.showErrorMessage('Open an ADO pipeline document first ("ADO: Edit pipeline YAML").');
        return;
      }
      const meta = provider!.metaFor(editor.document.uri);
      if (!meta) return;
      const client = state.client();
      if (!client) return;
      const newBranch = await vscode.window.showInputBox({
        prompt: 'New branch name',
        value: `pipelines/${meta.pipelineName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
        validateInput: (v) => v.trim() ? null : 'Required',
      });
      if (!newBranch) return;
      const message = await vscode.window.showInputBox({
        prompt: 'Commit message',
        value: `Update ${meta.path}`,
      });
      if (!message) return;
      try {
        const push = await client.pushGitChange(meta.repoId, {
          refUpdates: [{ name: `refs/heads/${newBranch}`, oldObjectId: meta.baseObjectId }],
          commits: [{
            comment: message,
            changes: [{
              changeType: 'edit',
              item: { path: meta.path },
              newContent: { content: editor.document.getText(), contentType: 'rawtext' },
            }],
          }],
        });
        const pick = await vscode.window.showInformationMessage(
          `Pushed to ${newBranch} (commit ${push.commits[0]?.commitId.slice(0, 8)}).`,
          'Open PR',
          'View branch',
        );
        if (pick === 'Open PR') {
          await vscode.env.openExternal(vscode.Uri.parse(client.webUrlForCreatePr(meta.repoId, newBranch, meta.branch)));
        } else if (pick === 'View branch') {
          await vscode.env.openExternal(vscode.Uri.parse(client.webUrlForBranch(meta.repoId, newBranch)));
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Push failed: ${(e as Error).message}`);
      }
    }),
  );
}

async function pickBranch(client: ReturnType<typeof state.client>, repoId: string, defaultBranch: string): Promise<string | undefined> {
  if (!client) return undefined;
  let branches: string[] = [];
  try {
    const r = await client.listGitRefs(repoId, 'heads/');
    branches = r.value.map((x) => x.name.replace(/^refs\/heads\//, ''));
  } catch {
    // fall back to manual entry
  }
  const items: vscode.QuickPickItem[] = branches.map((b) => ({ label: b }));
  const pick = await vscode.window.showQuickPick(items.length ? items : [{ label: defaultBranch }], {
    placeHolder: 'Select branch to load YAML from',
    matchOnDescription: true,
  });
  return pick?.label;
}
