import * as vscode from 'vscode';

const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
// VS Code's Microsoft auth provider uses Microsoft Graph scopes by convention,
// but accepts any AAD resource via the `<resource>/.default` syntax.
const ADO_SCOPE = `${ADO_RESOURCE_ID}/.default`;

export function registerAuth(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('adoPipelines.signIn', async () => {
      await getAccessToken({ createIfNone: true });
      await vscode.commands.executeCommand('adoPipelines.refresh');
    }),
    vscode.commands.registerCommand('adoPipelines.signOut', async () => {
      // VS Code does not expose a programmatic sign-out for the built-in `microsoft`
      // auth provider; users must remove the session from Accounts → Manage Trusted.
      vscode.window.showInformationMessage(
        'Open the Accounts gear (bottom-left) → Manage Trusted Extensions to revoke ADO sign-in.',
      );
    }),
  );
}

export async function getAccessToken(opts: { createIfNone?: boolean } = {}): Promise<string | null> {
  const session = await vscode.authentication.getSession('microsoft', [ADO_SCOPE], {
    createIfNone: opts.createIfNone ?? false,
    silent: !opts.createIfNone,
  });
  return session?.accessToken ?? null;
}
