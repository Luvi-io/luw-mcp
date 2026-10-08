// Prints the one-click install links used in README.md (re-run if the package name or hosted URL changes).
// Cursor and VS Code add the hosted server with no key: the client signs the user in to Luw.ai (OAuth).
const pkgName = "@luw-ai/mcp";
const url = "https://mcp.luw.ai/mcp";
const withKey = { command: "npx", args: ["-y", pkgName], env: { LUW_API_KEY: "YOUR_LUW_API_KEY" } };

// Cursor: base64 JSON config.
const cursor = `https://cursor.com/en-US/install-mcp?name=luw&config=${encodeURIComponent(Buffer.from(JSON.stringify({ url })).toString("base64"))}`;

// VS Code: remote servers need an explicit type.
const vscodeQuery = `name=luw&config=${encodeURIComponent(JSON.stringify({ type: "http", url }))}`;

// Kiro: URL-encoded JSON config (not base64); Kiro asks before writing it, then the user replaces the key placeholder.
const kiro = `https://kiro.dev/launch/mcp/add?name=luw&config=${encodeURIComponent(JSON.stringify(withKey))}`;

console.log(`Cursor:           ${cursor}`);
console.log(`VS Code:          https://vscode.dev/redirect/mcp/install?${vscodeQuery}`);
console.log(`VS Code Insiders: https://insiders.vscode.dev/redirect/mcp/install?${vscodeQuery}&quality=insiders`);
console.log(`Kiro:             ${kiro}`);
