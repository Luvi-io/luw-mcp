// Prints the one-click install links used in README.md (re-run if the package name changes).
const pkgName = "@luw-ai/mcp";
const stdio = { command: "npx", args: ["-y", pkgName] };

// Cursor: base64 JSON config; the user replaces the key placeholder in Cursor's MCP settings.
const cursorConfig = { ...stdio, env: { LUW_API_KEY: "YOUR_LUW_API_KEY" } };
const cursor = `https://cursor.com/en-US/install-mcp?name=luw&config=${encodeURIComponent(Buffer.from(JSON.stringify(cursorConfig)).toString("base64"))}`;

// VS Code: prompts for the key as a password input, stored in VS Code's secret storage.
const inputs = [{ type: "promptString", id: "luw_api_key", description: "Luw.ai API key (https://app.luw.ai/dashboard/api)", password: true }];
const vscodeConfig = { ...stdio, env: { LUW_API_KEY: "${input:luw_api_key}" } };
const vscodeQuery = `name=luw&inputs=${encodeURIComponent(JSON.stringify(inputs))}&config=${encodeURIComponent(JSON.stringify(vscodeConfig))}`;

console.log(`Cursor:          ${cursor}`);
console.log(`VS Code:         https://vscode.dev/redirect/mcp/install?${vscodeQuery}`);
console.log(`VS Code Insiders: https://insiders.vscode.dev/redirect/mcp/install?${vscodeQuery}&quality=insiders`);
