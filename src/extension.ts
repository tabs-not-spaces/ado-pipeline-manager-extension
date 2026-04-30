import * as vscode from 'vscode';
import { registerAuth } from './auth';
import { registerPipelinesView } from './views/pipelinesView';
import { registerRunsView } from './views/runsView';
import { registerStepsView } from './views/stepsView';
import { registerLogProvider } from './log';
import { registerEditorProvider } from './editor';
import { registerTrigger } from './trigger';
import { registerExtras } from './extras';
import { watchConfigChanges } from './state';

export function activate(context: vscode.ExtensionContext) {
  registerAuth(context);
  watchConfigChanges(context);
  const pipelines = registerPipelinesView(context);
  registerRunsView(context);
  registerStepsView(context);
  registerLogProvider(context);
  registerEditorProvider(context);
  registerTrigger(context);
  registerExtras(context, pipelines);
}

export function deactivate() {
  // Disposables registered via context.subscriptions are cleaned up by VS Code.
}

