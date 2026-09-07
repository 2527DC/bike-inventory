// Two rules from AGENTS.md:
//
//   1. Git commands that WRITE need explicit approval  -> "ask"
//   2. NOTHING is ever committed or pushed to main from local -> "deny"
//
// NPM IS NOT GATED. Owner's instruction, 1 Sep 2026: npm runs without prompting.
//
//   ⚠ The previous version of this comment said npm/npx/pnpm/yarn had been "removed from the
//   match below". They had NOT been — they were still in GATED, so every `npm run build`
//   passed the gate, matched none of the deny patterns, and fell through to the blanket
//   "ask" at the bottom. Only the permissions.allow entry in settings.json was keeping the
//   prompt away. They are removed now, for real: this hook is about git and nothing else.
//
// RULE 1 NARROWED (owner, 7 Sep 2026): read-only git no longer prompts.
//
// It used to return "ask" for EVERY git command, `git status` and `git log` included, which
// made the prompt something to dismiss rather than read — and a prompt answered by reflex is
// not a safeguard. Now only commands that change something ask. The read-only ones are on
// permissions.allow in settings.json and this hook stays silent for them.
//
// BOTH FILES MATTER, and that is the trap this hook has fallen into once already: narrowing
// settings.json alone changes nothing, because a hook returning "ask" overrides an allow
// rule. The list below is the one that decides.
//
// Rule 2 is untouched and is the one that matters most: a commit or push to main is still
// DENIED, not merely prompted.
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

  // Match git at the start of the command or after a shell separator
  // (; && || | & newline), so `cd foo && git commit` is caught too.
  const GATED = /(?:^|[;&|\n]|\|\||&&)\s*git\b/i;
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

  // ── Rule 1: git commands that CHANGE something need approval ────────────
  //
  // Everything not listed here — status, diff, log, show, branch (listing), remote, fetch,
  // rev-parse, ls-files, blame, describe, shortlog, reflog, stash list — returns silently
  // below and is handled by permissions.allow in settings.json, so it runs without a prompt.
  //
  // The list is deliberately WIDER than "commit, merge, push". Those three are what the
  // owner named, but `reset --hard`, `clean -fd`, `checkout -- .` and `restore` destroy
  // uncommitted work just as permanently and with no undo, so they ask too. `stash pop` is
  // here because it can conflict and lose the stash entry.
  //
  // Order matters within the alternation only where one command is a prefix of another; the
  // sub-command forms (stash drop, branch -D, tag -d) are spelled out so that plain
  // `git stash list`, `git branch` and `git tag` stay free.
  const WRITE_OPS = new RegExp(
    "\\bgit\\s+(?:" +
      [
        "commit", "merge", "push", "rebase", "cherry-pick", "revert", "am",
        "reset", "clean", "restore", "apply", "update-ref", "filter-branch",
        "checkout\\s+--",                       // discards changes; plain checkout <branch> is free
        "stash\\s+(?:drop|clear|pop)",          // `stash list` / `stash push` stay free
        "branch\\s+(?:-D|-d\\b|--delete)",      // `git branch` listing stays free
        "tag\\s+(?:-d\\b|--delete)",            // `git tag` listing stays free
      ].join("|") +
      ")",
    "i"
  );

  if (!WRITE_OPS.test(bare)) return; // read-only git: no prompt

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "Project rule (AGENTS.md): this git command changes something, so it needs your " +
          "explicit approval. Read-only git (status, diff, log, ...) runs without asking. " +
          "Choose No if you'd rather run it yourself — Claude will hand you the command and wait for the output.",
      },
    })
  );
});
