# ADO Pipeline Manager — VS Code Extension

> Browse Azure DevOps pipelines, runs, and live logs from the activity bar.
> Edit pipeline YAML and queue runs with full parameter / variable / resource support.

This extension is a port of the standalone SPA (`../ado-pipeline-viewer`) into a first-class
VS Code extension. The SPA's "pane of glass" UI maps to native VS Code primitives:

| SPA concept                           | VS Code equivalent                                                      |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Pipelines pane (folder tree)          | Activity-bar `TreeView` with collapsible folders                        |
| Pipeline overview pane                | `Webview` (artifact list + recent runs) or `MarkdownPreview` doc        |
| Runs pane                             | `TreeView` (rows with status icons)                                     |
| Steps pane                            | `TreeView` of timeline records                                          |
| Log pane (streaming, ANSI)            | Custom `TextDocumentContentProvider` with `ado-log:` scheme + Range polling |
| YAML editor with save-to-branch       | `ado-pipeline:` virtual doc opened in real editor; on save → quick pick → push |
| Path finder (file-explorer breadcrumb)| QuickPick + setting-driven filter context                               |
| Settings popover                      | `workbench.action.openSettings` → `@ext:...`                            |
| Cmd/Ctrl+Shift+P shortcut             | Native command palette already provides this                            |

## Auth

Uses VS Code's built-in **Microsoft auth provider** (`vscode.authentication.getSession('microsoft', [...])`)
with the Azure DevOps resource scope: `499b84ac-1321-427f-aa17-267ca6975798/.default`.
No app registration required, no PKCE plumbing — VS Code handles the OAuth flow with the user's
signed-in Microsoft account. This is the canonical way to call ADO from a VS Code extension and
solves the "first-party app id" problem the SPA hit.

## Configuration (settings.json)

```jsonc
{
  "adoPipelines.org": "contoso",
  "adoPipelines.project": "MyProject",
  "adoPipelines.tenantId": "organizations"
}
```

## Layout

```
src/
├── extension.ts          # activate / deactivate, wires everything
├── auth/index.ts         # vscode.authentication wrapper (signIn, signOut, getAccessToken)
├── state.ts              # singleton state holder (org/project client, selected pipeline + run)
├── api/
│   ├── ado.ts            # AdoClient (ported from SPA, includes Range-based getLogChunk)
│   └── types.ts          # ADO REST types (verbatim copy from SPA)
├── views/
│   ├── pipelinesView.ts  # TreeDataProvider — folder tree, latest-build status icons
│   ├── runsView.ts       # TreeDataProvider — recent runs (5s active / 30s idle poll)
│   └── stepsView.ts      # TreeDataProvider — timeline (2s active / 10s idle poll)
├── log.ts                # ado-log: scheme provider, Range streaming (1s active)
├── editor.ts             # ado-pipeline: scheme provider + savePipelineToBranch flow
├── trigger.ts            # multi-step QuickPick run-pipeline flow
├── extras.ts             # cancelRun, openRunOverview webview, commandPalette
└── util/
    ├── folderTree.ts     # folder tree builder (verbatim from SPA)
    └── icons.ts          # status → ThemeIcon mapping (sync~spin / pass-filled / error / …)
```

## Install — local development

Two ways to run the extension on your machine.

### 1. Run from source (recommended while iterating)

```bash
git clone <this repo>
cd ado-pipeline-manager-extension
npm install
npm run watch        # leave running — recompiles on save
```

Then in VS Code:

1. `File → Open Folder…` → pick the extension folder.
2. Press **F5** (or `Run → Start Debugging`). A second VS Code window opens — the **Extension Development Host** — with the extension loaded.
3. In that window, click the new **infinity** icon in the activity bar.

### 2. Install as a `.vsix`

```bash
npm install
npm run build
npm run package      # produces ado-pipeline-manager.vsix
```

In VS Code: `Extensions` view → `…` menu → **Install from VSIX…** → pick the file.

> Note: `package.json` uses `"publisher": "powers-hell"`. To publish to the Marketplace under that publisher you need a matching PAT (`vsce login powers-hell`).

## First-time setup (in the dev host or after VSIX install)

1. Open Settings (`Cmd/Ctrl+,`) and set:
   - `adoPipelines.org` — e.g. `contoso`
   - `adoPipelines.project` — e.g. `MyProject`
   - (optional) `adoPipelines.tenantId` — defaults to `organizations`
2. Click the infinity icon in the activity bar.
3. Click **Sign in to Azure DevOps** in the welcome view (or run `ADO: Sign in` from the command palette). VS Code's account flow prompts for your Microsoft account.
4. Pipelines should populate.

## Smoke test checklist

After F5, verify each:

| Step | Expected |
| --- | --- |
| Activity bar → infinity icon | Three views appear: Pipelines / Recent Runs / Steps & Logs |
| Click a pipeline | Recent Runs view populates |
| Click a run | Steps & Logs view populates with a hierarchical timeline |
| Click a step with a log icon | New editor tab opens (`ado-log:`) and streams output. Live steps refresh every 1 s |
| Right-click pipeline → **Run pipeline** | QuickPick chain: branch → params → variables. Submitting queues a run and auto-selects it |
| Right-click pipeline → **Edit pipeline YAML** | Opens an `ado-pipeline:` editor with the YAML at the chosen branch |
| With YAML editor focused → `Cmd/Ctrl+S` | Prompts for new branch name + commit message, then offers **Open PR** / **View branch** |
| Right-click an in-progress run → **Cancel run** | Run state flips to `cancelling` after a refresh |
| `Cmd/Ctrl+Alt+P` | Pipeline command palette QuickPick (fuzzy across all pipelines) |
| Settings change for `adoPipelines.org/project` | Tree refreshes against the new org without reload |

## Troubleshooting

- **"No pipelines"** — check `adoPipelines.org` / `adoPipelines.project` and that you signed in (status bar `Accounts` gear → confirm a Microsoft account is signed in).
- **`401`s** — sign out via `Accounts → Manage Trusted Extensions` and run `ADO: Sign in` again. The built-in provider has no programmatic sign-out.
- **Log doesn't stream** — only `inProgress` steps poll. Completed steps show the final body once and stop.
- **Save did nothing** — `Cmd/Ctrl+S` is only intercepted on `ado-pipeline:` documents. Verify the editor's title bar shows the scheme.

## Status

Feature-complete v0.1: pipelines / runs / steps tree views, live log streaming, YAML edit + push to branch, multi-step run flow, cancel, run overview webview, pipeline command palette. See `AGENTS.md` for porting details and SPA cross-references.
