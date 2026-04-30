import * as vscode from 'vscode';
import type { AdoBuild, AdoRun, TimelineRecord } from '../api/types';

export function buildIcon(build?: AdoBuild | null): vscode.ThemeIcon {
  if (!build) return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  if (build.status === 'inProgress' || build.status === 'cancelling' || build.status === 'notStarted') {
    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
  }
  switch (build.result) {
    case 'succeeded': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    case 'partiallySucceeded': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
    case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    case 'canceled': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
    default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

export function runIcon(r: AdoRun): vscode.ThemeIcon {
  if (r.state === 'inProgress' || r.state === 'canceling') {
    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
  }
  switch (r.result) {
    case 'succeeded': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    case 'partiallySucceeded': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
    case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    case 'canceled': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
    default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

export function recordIcon(r: TimelineRecord): vscode.ThemeIcon {
  if (r.state === 'inProgress') return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
  if (r.state === 'pending') return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  switch (r.result) {
    case 'succeeded': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    case 'partiallySucceeded': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
    case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    case 'canceled': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
    case 'skipped': return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('descriptionForeground'));
    default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

export function describeBuild(b?: AdoBuild | null): string {
  if (!b) return 'No runs yet';
  const when = b.finishTime ?? b.startTime ?? '';
  const status = b.status === 'inProgress' ? 'Running' : (b.result ?? b.status ?? 'unknown');
  return `${b.buildNumber} · ${status}${when ? ' · ' + new Date(when).toLocaleString() : ''}`;
}
