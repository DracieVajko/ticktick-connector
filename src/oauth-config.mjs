// The TickTick OAuth application is shared by the standalone MCP server and the
// Cindy plugin, so both read it from here instead of from the plugin manifest.
// Desktop OAuth client ids are not secrets: the user still approves access in
// the browser, and PKCE protects the code exchange.
export const OAUTH = {
  authorizeUrl: 'https://ticktick.com/oauth/authorize',
  tokenUrl: 'https://api.ticktick.com/oauth/token',
  // The Cindy plugin exchanges the code *before* it has a credential, and the
  // host refuses to send any request to an injected host while that credential
  // is missing. TickTick answers the token endpoint on both hostnames from the
  // same backend, so the plugin uses the one it does not inject into.
  cindyTokenUrl: 'https://ticktick.com/oauth/token',
  clientId: '4OO7Zzir01YsqCXfo6',
  scopes: ['tasks:read', 'tasks:write'],
  redirectPort: 53682,
};
