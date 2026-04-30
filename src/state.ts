import * as vscode from 'vscode';
import { AdoClient } from './api/ado';

export interface SelectedPipeline { id: number; name: string; folder?: string }
export interface SelectedRun { id: number; name: string }

class State {
  private _client: AdoClient | null = null;
  private _pipeline: SelectedPipeline | null = null;
  private _run: SelectedRun | null = null;
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this._emitter.event;

  client(): AdoClient | null {
    if (this._client) return this._client;
    this._client = AdoClient.fromConfig();
    return this._client;
  }
  resetClient() {
    this._client = null;
    this._pipeline = null;
    this._run = null;
    void vscode.commands.executeCommand('setContext', 'adoPipelines.pipelineSelected', false);
    void vscode.commands.executeCommand('setContext', 'adoPipelines.runSelected', false);
    this._emitter.fire();
  }

  pipeline() { return this._pipeline; }
  setPipeline(p: SelectedPipeline | null) {
    this._pipeline = p;
    this._run = null;
    void vscode.commands.executeCommand('setContext', 'adoPipelines.pipelineSelected', !!p);
    void vscode.commands.executeCommand('setContext', 'adoPipelines.runSelected', false);
    this._emitter.fire();
  }

  run() { return this._run; }
  setRun(r: SelectedRun | null) {
    this._run = r;
    void vscode.commands.executeCommand('setContext', 'adoPipelines.runSelected', !!r);
    this._emitter.fire();
  }
}

export const state = new State();

export function watchConfigChanges(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('adoPipelines')) state.resetClient();
    }),
  );
}
