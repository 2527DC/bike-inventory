// Two rules, both from AGENTS.md:
//
//   1. Every git / npm command needs explicit approval  -> "ask"
//   2. NOTHING is ever committed or pushed to main from local -> "deny"
//
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

  // Strip quoted spans before matching, so a command that CARRIES git text as DATA is not
  // mistaken for one that RUNS it. Without this, `node -e '... git push ...'` and any
  // heredoc documenting a git command match and — since rule 2 denies rather than asks —
  // legitimate work gets blocked outright. Learned the hard way: this hook denied the very
  // edit that was adding rule 2 to AGENTS.md.
  //
  // Deliberately simple: replace the CONTENTS of '...' and "..." with spaces, keeping the
  // quotes so token boundaries survive. It does not model escaping or nesting, and does not
  // need to — the question is only "is there a git command at a command position".
  const stripQuoted = (s) => {
    let out = "";
    let quote = null;
    for (const ch of s) {
      if (quote) {
        out += ch === quote ? ch : " ";
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        out += ch;
      } else {
        out += ch;
      }
    }
    return out;
  };

  const bare = stripQuoted(cmd);

  // Match git/npm at the start of the command or after a shell separator
  // (; && || | & newline), so `cd foo && npm install` is caught too.
  const GATED = /(?:^|[;&|\n]|\|\||&&)\s*(?:git|npm|npx|pnpm|yarn)\b/i;
  if (!GATED.test(bare)) return;

  const deny = (reason) =>
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      })
    );

  // ── Rule 2: main is written by pull request only ────────────────────────
  //
  // Checked BEFORE the ask, because a prompt the user might approve by reflex is not a
  // safeguard. These are denied outright; the work goes on a branch and reaches main
  // through a PR.
  // `git push` that targets main explicitly, e.g.
  //   git push origin main        git push -u origin main        git push origin HEAD:main
  //
  // `main` must be a WHOLE argument. \bmain\b is not enough: `-` is a word boundary, so it
  // matched `chore/no-main-writes` and denied pushing a perfectly ordinary branch — which is
  // exactly what happened the first time this hook was used in anger.
  //
  // So the name must be preceded by whitespace, a `:` (HEAD:main) or a remote prefix, and
  // followed by whitespace or end of argument.
  const PUSH_TO_MAIN =
    /\bgit\s+push\b[^\n;&|]*(?:\s|:)(?:origin\/|upstream\/)?(?:main|master)(?=\s|$)/i;

  // A bare `git push` while checked out on main. The branch is read at run time rather
  // than parsed from the command, because a bare push carries no branch name at all.
  const BARE_PUSH = /\bgit\s+push\b(?![^\n;&|]*\b(?:origin|upstream)\b\s+\S)/i;

  const COMMIT = /\bgit\s+(?:commit|merge|rebase|cherry-pick|revert|am)\b/i;

  if (PUSH_TO_MAIN.test(bare)) {
    return deny(
      "Project rule (AGENTS.md): never push to main from local. main is updated by pull " +
        "request only. Push the feature branch and open a PR instead."
    );
  }

  if (BARE_PUSH.test(bare) || COMMIT.test(bare)) {
    let branch = "";
    try {
      branch = require("child_process")
        .execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
        .trim();
    } catch {
      // Not a repo, or git unavailable. Fall through to the normal ask rather than
      // blocking work on a failed lookup.
    }

    if (branch === "main" || branch === "master") {
      return deny(
        `Project rule (AGENTS.md): you are on "${branch}" and nothing is committed or ` +
          "pushed to it from local. Create a branch first:\n\n" +
          "    git checkout -b <type>/<short-name>\n\n" +
          "then commit there and open a pull request."
      );
    }
  }

  // ── Rule 1: everything else git/npm still needs approval ────────────────
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
