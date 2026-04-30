import * as vscode from 'vscode';
import { state } from './state';

const SCHEME = 'ado-log';

interface LogState {
  text: string;
  nextByte: number;
  active: boolean;
  timer: NodeJS.Timeout | null;
  err: string | null;
}

class LogProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this._emitter.event;
  private logs = new Map<string, LogState>();

  // URI: ado-log://<buildId>/<logId>?stepName=...
  uriFor(buildId: number, logId: number, stepName: string): vscode.Uri {
    return vscode.Uri.parse(`${SCHEME}://${buildId}/${logId}?stepName=${encodeURIComponent(stepName)}`);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.toString();
    const s = this.logs.get(key);
    if (!s) {
      this.start(uri);
      return '';
    }
    if (s.err) return `# Error fetching log\n${s.err}\n`;
    return s.text || '# Loading...';
  }

  private parse(uri: vscode.Uri): { buildId: number; logId: number } {
    const buildId = parseInt(uri.authority, 10);
    const logId = parseInt(uri.path.replace(/^\//, ''), 10);
    return { buildId, logId };
  }

  private async start(uri: vscode.Uri) {
    const key = uri.toString();
    const s: LogState = { text: '', nextByte: 0, active: true, timer: null, err: null };
    this.logs.set(key, s);
    void this.tick(uri);
  }

  private async tick(uri: vscode.Uri) {
    const key = uri.toString();
    const s = this.logs.get(key);
    if (!s) return;
    const client = state.client();
    if (!client) {
      s.err = 'Not signed in. Run "ADO: Sign in".';
      this._emitter.fire(uri);
      return;
    }
    const { buildId, logId } = this.parse(uri);
    try {
      const chunk = await client.getLogChunk(buildId, logId, s.nextByte);
      if (chunk.appended && chunk.text.length > 0) {
        s.text += chunk.text;
      } else if (!chunk.appended) {
        s.text = chunk.text;
      }
      s.nextByte = chunk.nextByte;
      s.err = null;
    } catch (e) {
      s.err = (e as Error).message;
    }
    // Detect liveness via timeline (cached short-lived).
    const isLive = await this.isStepLive(buildId, logId).catch(() => false);
    s.active = isLive;
    this._emitter.fire(uri);
    const cfg = vscode.workspace.getConfiguration('adoPipelines');
    if (isLive) {
      const ms = cfg.get<number>('logRefreshIntervalActiveMs', 1000);
      s.timer = setTimeout(() => this.tick(uri), ms);
    }
    // Completed step: no more polling. Range fetch already settled the doc.
  }

  private async isStepLive(buildId: number, logId: number): Promise<boolean> {
    const client = state.client();
    if (!client) return false;
    try {
      const t = await client.getTimeline(buildId);
      const r = (t.records ?? []).find((x) => x.log?.id === logId);
      return r?.state === 'inProgress';
    } catch { return false; }
  }

  closeStream(uri: vscode.Uri) {
    const key = uri.toString();
    const s = this.logs.get(key);
    if (s?.timer) clearTimeout(s.timer);
    this.logs.delete(key);
  }

  dispose() {
    for (const s of this.logs.values()) if (s.timer) clearTimeout(s.timer);
    this.logs.clear();
  }
}

function chunkAppendedZero(_s: LogState) { return false; }
void chunkAppendedZero;

let provider: LogProvider | null = null;

export function registerLogProvider(context: vscode.ExtensionContext) {
  provider = new LogProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    provider,
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === SCHEME) provider?.closeStream(doc.uri);
    }),
    vscode.commands.registerCommand('adoPipelines.openLog', async (buildId: number, logId: number, stepName: string) => {
      if (!provider) return;
      const uri = provider.uriFor(buildId, logId, stepName);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, 'log');
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }),
  );
}
