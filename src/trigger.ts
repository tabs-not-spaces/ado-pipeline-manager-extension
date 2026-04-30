import * as vscode from 'vscode';
import { state } from './state';
import type { RunPipelineOpts } from './api/ado';
import type { AdoPipeline, AdoVariable } from './api/types';

export function registerTrigger(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('adoPipelines.runPipeline', async (arg: { pipeline: AdoPipeline } | AdoPipeline) => {
      const p: AdoPipeline = ('pipeline' in (arg as object) ? (arg as { pipeline: AdoPipeline }).pipeline : (arg as AdoPipeline));
      const client = state.client();
      if (!client) { vscode.window.showErrorMessage('ADO not configured / not signed in'); return; }
      let detail;
      try { detail = await client.getPipeline(p.id); }
      catch (e) { vscode.window.showErrorMessage(`ADO: ${(e as Error).message}`); return; }

      const repoId = detail.configuration?.repository?.id;
      const branch = await pickBranch(client, repoId);
      if (branch === undefined) return;

      // Pre-fill from latest run.
      let latestParams: Record<string, unknown> = {};
      let latestVars: Record<string, AdoVariable> = {};
      try {
        const runs = await client.listRuns(p.id);
        const latest = runs.value?.[0];
        if (latest) {
          const det = await client.getRun(p.id, latest.id);
          latestParams = det.templateParameters ?? {};
          latestVars = det.variables ?? {};
        }
      } catch { /* optional */ }

      const templateParameters = await collectKV('Template parameters', latestParams);
      if (templateParameters === undefined) return;
      const variables = await collectVars(latestVars);
      if (variables === undefined) return;

      const opts: RunPipelineOpts = {
        branch: branch || undefined,
        templateParameters: Object.keys(templateParameters).length ? templateParameters : undefined,
        variables: Object.keys(variables).length ? variables : undefined,
      };

      try {
        const run = await client.runPipeline(p.id, opts);
        state.setPipeline({ id: p.id, name: p.name, folder: p.folder });
        state.setRun({ id: run.id, name: run.name || `#${run.id}` });
        vscode.window.showInformationMessage(`Queued run ${run.name || '#' + run.id}.`);
        await vscode.commands.executeCommand('adoPipelines.refresh');
      } catch (e) {
        vscode.window.showErrorMessage(`Run failed: ${(e as Error).message}`);
      }
    }),
  );
}

async function pickBranch(client: ReturnType<typeof state.client>, repoId: string | undefined): Promise<string | undefined> {
  if (!client) return undefined;
  let items: vscode.QuickPickItem[] = [{ label: '$(git-branch) Default branch', description: 'Use the pipeline default' }];
  if (repoId) {
    try {
      const r = await client.listGitRefs(repoId, 'heads/');
      items = items.concat(r.value.map((x) => ({ label: x.name.replace(/^refs\/heads\//, '') })));
    } catch { /* ignore */ }
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Branch to run from' });
  if (!pick) return undefined;
  return pick.label.startsWith('$(git-branch)') ? '' : pick.label;
}

async function collectKV(label: string, seed: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const result: Record<string, unknown> = { ...seed };
  while (true) {
    const items: vscode.QuickPickItem[] = [
      { label: '$(check) Done', description: `${Object.keys(result).length} ${label.toLowerCase()}` },
      { label: '$(add) Add / edit entry' },
      ...Object.entries(result).map(([k, v]) => ({ label: `$(symbol-key) ${k}`, description: typeof v === 'string' ? v : JSON.stringify(v) })),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: label });
    if (!pick) return undefined;
    if (pick.label.startsWith('$(check)')) return result;
    if (pick.label.startsWith('$(add)')) {
      const k = await vscode.window.showInputBox({ prompt: `${label}: key` });
      if (!k) continue;
      const v = await vscode.window.showInputBox({ prompt: `${label}: value`, value: typeof result[k] === 'string' ? String(result[k]) : '' });
      if (v === undefined) continue;
      result[k] = v;
    } else if (pick.label.startsWith('$(symbol-key)')) {
      const k = pick.label.replace(/^\$\(symbol-key\)\s*/, '');
      const v = await vscode.window.showInputBox({ prompt: `${label}: ${k} (empty to delete)`, value: typeof result[k] === 'string' ? String(result[k]) : '' });
      if (v === undefined) continue;
      if (v === '') delete result[k]; else result[k] = v;
    }
  }
}

async function collectVars(seed: Record<string, AdoVariable>): Promise<Record<string, AdoVariable> | undefined> {
  const result: Record<string, AdoVariable> = { ...seed };
  while (true) {
    const items: vscode.QuickPickItem[] = [
      { label: '$(check) Done', description: `${Object.keys(result).length} variables` },
      { label: '$(add) Add / edit variable' },
      ...Object.entries(result).map(([k, v]) => ({ label: `$(symbol-variable) ${k}`, description: v.isSecret ? '(secret)' : v.value })),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Variables' });
    if (!pick) return undefined;
    if (pick.label.startsWith('$(check)')) return result;
    if (pick.label.startsWith('$(add)')) {
      const k = await vscode.window.showInputBox({ prompt: 'Variable name' });
      if (!k) continue;
      const v = await vscode.window.showInputBox({ prompt: `Value for ${k}`, value: result[k]?.value ?? '' });
      if (v === undefined) continue;
      const secret = await vscode.window.showQuickPick(['No', 'Yes'], { placeHolder: 'Mark as secret?' });
      if (!secret) continue;
      result[k] = { value: v, isSecret: secret === 'Yes' };
    } else if (pick.label.startsWith('$(symbol-variable)')) {
      const k = pick.label.replace(/^\$\(symbol-variable\)\s*/, '');
      const v = await vscode.window.showInputBox({ prompt: `Value for ${k} (empty to delete)`, value: result[k]?.value ?? '' });
      if (v === undefined) continue;
      if (v === '') delete result[k]; else result[k] = { value: v, isSecret: !!result[k]?.isSecret };
    }
  }
}
