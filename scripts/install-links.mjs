// Prints the one-click install links used in README.md (re-run if the package name changes).
const pkgName = "@luw-ai/mcp";
const stdio = { command: "npx", args: ["-y", pkgName] };
const remote = { url: "https://mcp.luw.ai/mcp", headers: { Authorization: "Bearer YOUR_LUW_API_KEY" } };
const withKey = { ...stdio, env: { LUW_API_KEY: "YOUR_LUW_API_KEY" } };
const base64 = (config) => encodeURIComponent(Buffer.from(JSON.stringify(config)).toString("base64"));

// Cursor: base64 JSON config; the user replaces the key placeholder in Cursor's MCP settings.
const cursor = (config) => `https://cursor.com/en-US/install-mcp?name=luw&config=${base64(config)}`;

// VS Code: prompts for the key as a password input, stored in VS Code's secret storage.
const inputs = [{ type: "promptString", id: "luw_api_key", description: "Luw.ai API key (https://app.luw.ai/dashboard/api)", password: true }];
const vscodeConfig = { ...stdio, env: { LUW_API_KEY: "${input:luw_api_key}" } };
const vscodeQuery = `name=luw&inputs=${encodeURIComponent(JSON.stringify(inputs))}&config=${encodeURIComponent(JSON.stringify(vscodeConfig))}`;

// Kiro: URL-encoded JSON config (not base64); Kiro asks before writing it.
const kiro = `https://kiro.dev/launch/mcp/add?name=luw&config=${encodeURIComponent(JSON.stringify(withKey))}`;

console.log(`Cursor:           ${cursor(withKey)}`);
console.log(`Cursor (hosted):  ${cursor(remote)}`);
console.log(`VS Code:          https://vscode.dev/redirect/mcp/install?${vscodeQuery}`);
console.log(`VS Code Insiders: https://insiders.vscode.dev/redirect/mcp/install?${vscodeQuery}&quality=insiders`);
console.log(`Kiro:             ${kiro}`);
