// Forces a permission prompt for every git / npm command.
// Project rule: see "git and npm commands: ALWAYS ask first" in AGENTS.md.
// Runs as a PreToolUse hook on Bash|PowerShell. Reads the hook payload on stdin.

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = (JSON.parse(raw).tool_input || {}).command || "";
  } catch {
    // Malformed payload: stay silent, let normal permission handling apply.
    return;
  }

  // Match git/npm at the start of the command or after a shell separator
  // (; && || | & newline), so `cd foo && npm install` is caught too.
  const GATED = /(?:^|[;&|\n]|\|\||&&)\s*(?:git|npm|npx|pnpm|yarn)\b/i;
  if (!GATED.test(cmd)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "Project rule (AGENTS.md): git/npm commands need your explicit approval. " +
          "Choose No if you'd rather run it yourself — Claude will hand you the command and wait for the output.",
      },
    })
  );
});
