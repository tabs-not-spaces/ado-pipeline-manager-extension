# Repository instructions for AI coding agents

> This file is the canonical brief for any LLM working on this repository.
> Read it fully before making changes.

## What this is

A **VS Code extension** that mirrors the functionality of the sibling SPA project
(`../ado-pipeline-viewer`) — a TypeScript SPA that browses Azure DevOps pipelines,
runs, and live logs in a "pane of glass" UI, with rich pipeline triggering and
YAML editing with save-to-branch.

This project is the first-class VS Code port. Functional parity with the SPA is
the goal. Where the SPA reinvents UI primitives (panes, popovers, breadcrumbs),
this project should reuse VS Code's native equivalents.

## Source of truth for ADO behaviour

The SPA in `../ado-pipeline-viewer` is the reference implementation for every
ADO REST interaction, polling cadence, and edge case (e.g. `$format=octetStream`
for raw YAML, Range requests for log streaming, 416/206/200 handling).
**When in doubt, read the SPA's code first.**

Mirror these SPA modules directly:

- `src/api/types.ts`              ↔ `ado-pipeline-viewer/src/api/types.ts`
- `src/api/ado.ts` (AdoClient)    ↔ `ado-pipeline-viewer/src/api/ado.ts`
- `src/util/folderTree.ts`        ↔ `ado-pipeline-viewer/src/util/folderTree.ts`

Keep them in sync. Tests for these modules in the SPA apply here verbatim.

## Auth

Use **`vscode.authentication.getSession('microsoft', [scope], options)`** with
scope `499b84ac-1321-427f-aa17-267ca6975798/.default` (the Azure DevOps API
resource id). VS Code's built-in Microsoft provider handles the entire OAuth
flow against the user's signed-in account. **Do not** roll your own PKCE / OIDC
flow, do not bundle `oidc-client-ts`, do not use device code, do not store
tokens in `globalState`. Always call `getSession` fresh; it caches internally.

`createIfNone: true` shows the consent prompt; `silent: true` (or default)
returns null if not signed in.

## Activation events

Extension activates on:

- `onView:adoPipelines.pipelines`  — opening the activity-bar view
- `onCommand:adoPipelines.signIn`  — explicit sign-in command
- `onCommand:adoPipelines.openSettings` — opening settings

Avoid `*` activation; it bloats startup.

## UI mapping (SPA → extension)

| SPA component                             | VS Code primitive                                                   |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `PipelinesPane` (folder tree + pipelines) | `TreeDataProvider` view `adoPipelines.pipelines`                    |
| Path finder + autocomplete                | `vscode.window.showInputBox` (filter), `QuickPick` (palette)        |
| `PipelineOverviewPane` (artifacts, runs)  | Webview panel `adoPipelines.overview` OR markdown virtual doc       |
| `RunOverviewPane`                         | Same — webview                                                      |
| `StepsPane` (timeline)                    | `TreeDataProvider` `adoPipelines.steps`                             |
| `LogPane` (live streaming, ANSI colors)   | `TextDocumentContentProvider` with scheme `ado-log:` + `EventEmitter<Uri>` for incremental updates; or `Pseudoterminal` (`vscode.window.createTerminal({ pty })`) for true ANSI rendering |
| `EditorPane` (Monaco YAML + save flow)    | `ado-pipeline:` virtual doc with real text editor; `onWillSaveTextDocument` hooks the push-to-branch quick pick |
| `TriggerForm`                             | Multi-step `QuickPick` chain: branch → param-by-param → variables → resources |
| Settings popover                          | `workbench.action.openSettings @ext:...`                            |
| Cmd/Ctrl+Shift+P                          | Native palette covers this; expose pipelines via QuickPick as a dedicated command |

### Live logs — implementation hint

Use `ado-log:` scheme registered via `workspace.registerTextDocumentContentProvider`.
Provider holds a Map<uri,string> of accumulated text. A polling loop calls
`AdoClient.getLogChunk(buildId, logId, fromByte)` (Range request) at intervals
from settings (`logRefreshIntervalActiveMs` / `IdleMs`). On each appended chunk,
update the map and fire `onDidChange(uri)` so VS Code re-pulls the doc.

For ANSI color rendering, prefer a `Pseudoterminal` (output channel doesn't render
ANSI on Windows). The pty's `onDidWrite` emitter pushes new bytes verbatim; xterm.js
inside VS Code handles colors.

### YAML editing — implementation hint

`ado-pipeline:` virtual doc provider returns content fetched via
`AdoClient.getGitItemContent(repoId, path, branch)`. On `onDidSaveTextDocument`,
intercept saves to this scheme: show a 2-step QuickPick (target branch, commit
message), then call `pushGitChange` with `oldObjectId` set to the base ref's
`objectId` (fetched via `listGitRefs`). On success, offer a `Open PR` action via
`vscode.env.openExternal(webUrlForCreatePr(...))`.

## Polling cadence (config-driven)

Match the SPA defaults. Configurable via `adoPipelines.*RefreshInterval*Ms`:

| What                                | Active (live)    | Idle (completed) |
| ----------------------------------- | ---------------- | ---------------- |
| Log (`ado-log:`)                    | 1000ms           | 5000ms then stop |
| Timeline (steps)                    | 2000ms           | 10000ms          |
| Latest builds (status icons)        | 10000ms          | 60000ms          |

Stop polling when no consumer (view collapsed, doc closed). Use `view.visible`
and `vscode.window.onDidChangeVisibleTextEditors` as triggers.

## Status icons (Pipelines + Runs trees)

Use `ThemeIcon` with built-in codicons:

| State                          | Icon                                          |
| ------------------------------ | --------------------------------------------- |
| inProgress / notStarted / cancelling | `$(sync~spin)` colored `charts.blue`     |
| succeeded                      | `$(pass-filled)` colored `charts.green`       |
| partiallySucceeded             | `$(warning)` colored `charts.orange`          |
| failed                         | `$(error)` colored `charts.red`               |
| canceled                       | `$(circle-slash)` colored `descriptionForeground` |
| no run yet                     | `$(circle-outline)` colored `descriptionForeground` |

## Conventions

- `npm run build` (tsc) → `out/extension.js`. No bundler unless bundle size is an issue.
- All disposables go through `context.subscriptions.push(...)`.
- All ADO calls go through `AdoClient`; never call `fetch` directly from views/commands.
- Errors from `AdoClient` are `AdoError` (status + message). Surface to user via
  `vscode.window.showErrorMessage`. 401 should prompt re-sign-in.
- Don't add a bundler, web framework, or webview UI library unless a feature
  genuinely requires it. The runs/steps lists are tree views, not webviews.

## Out of scope

- Rendering Monaco inside a webview. Use the real text editor instead.
- Reimplementing OIDC. Use `vscode.authentication`.
- A custom theme. The extension respects whatever VS Code theme the user has.

## How to verify changes

```bash
npm install
npm run build         # tsc
npm test              # vitest (for util/folderTree, AdoClient stubs)
# F5 inside VS Code → "Run Extension" → manual smoke test in dev host.
```

There is no linter check on commit; run `npm run lint` manually.

## Co-author trailer

When committing on behalf of GitHub Copilot, append to commit messages:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
