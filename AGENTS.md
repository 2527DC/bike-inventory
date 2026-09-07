# Development Rules

## Workflow: ASK → PLAN → BUILD → VERIFY
1. **ASK**: Questions before coding. Confirm understanding.
2. **PLAN**: List files to change. List files that might break. Get approval.
3. **BUILD**: Fix root cause across ALL affected files. One change at a time.
4. **VERIFY**: Run `npm run build`. Open the page. Check it works. Check nothing else broke.

## Verification (MANDATORY after every change)
```bash
npm run build
```
If build fails, fix it before anything else. Never skip this.

## Rules
- Never patch. Fix the actual cause.
- Never say "done" without running the build and checking the page.
- Never change shared code without updating every file that uses it.
- If your fix breaks something, revert and re-plan.
- If unsure, ask. Don't guess.

## Next.js
Breaking changes from your training data. Read `node_modules/next/dist/docs/` first.

## main is NEVER written from local

**Never commit to `main`. Never push to `main`.** Not with approval, not "just this once".
`main` is updated by **pull request only**.

Work goes on a branch — create it, commit there, push that branch, open a PR.

This is enforced rather than merely documented. `.claude/hooks/ask-git-npm.js` returns
**deny**, not "ask", for:

- any push naming `main` / `master` / `origin/main`
- a bare push while checked out on `main`
- `commit`, `merge`, `rebase`, `cherry-pick`, `revert` or `am` while on `main`

A prompt is not a safeguard here, because a prompt gets approved by reflex. The current
branch is read at run time, so a bare push is caught even though it names no branch.

Already on `main` with uncommitted work? Branch first — uncommitted changes follow the
checkout and nothing is lost.

> The hook strips quoted spans before matching, so a command that *carries* git text as data
> — a heredoc, a `node -e` string — is not mistaken for one that *runs* it. That distinction
> was learned the hard way: an earlier version denied the very edit adding this section.

## git commands that WRITE: ask first

**Changed 7 Sep 2026.** It used to be every git command. Read-only git no longer prompts —
a prompt that appears for `git status` is one you dismiss without reading, and a prompt
answered by reflex protects nothing.

Claude must never run a git command that **changes** something on its own initiative. Those
are gated by an `ask` rule in `.claude/settings.json` and by `.claude/hooks/ask-git-npm.js`,
so a prompt appears with the exact command before anything runs.

**Two files, and BOTH are required** — this is the trap the npm change fell into. Narrowing
`permissions.ask` alone changes nothing, because the hook returns `"ask"` on its own and
overrides an allow rule. `.claude/hooks/ask-git-npm.js` holds the list that actually decides;
`settings.json` mirrors it.

**npm is NOT gated** — changed 1 Sep 2026. `npm` and `npx` are on the `allow` list and run
without a prompt. (Until 7 Sep the hook's `GATED` regex still matched `npm`, despite a
comment claiming otherwise, so only the allow rule was keeping the prompt away. The regex is
git-only now.)

What did NOT change: a commit or push to `main` is still **denied**, not prompted.

**Before proposing the command**, state in one line: what it does and what it changes.
Then let the prompt appear.

### If I approve (Yes)
Run it, show the real output, and report the result plainly — including failures.

### If I decline (No)
- **Do NOT run it.** Do not retry it, do not rephrase it into a different command,
  do not route around it with another tool.
- Print the command in a copy-paste block, exactly as it should be typed:

  ```
  npm run build
  ```

- Say which shell to run it in (PowerShell or Git Bash) if it matters.
- Then **stop and ask me to paste back the output** you need to continue —
  name specifically what you need (full output, just the error lines, the exit code,
  `git status` after it, etc.).
- Wait. Do not continue the task on an assumption about what the command would have
  printed. Do not report the step as done.

Reminder: I can run a command in this session myself by typing `! <command>` at the
prompt — the output lands directly in the conversation.

### Scope

**Prompts** (changes something): `commit` · `merge` · `push` · `rebase` · `cherry-pick` ·
`revert` · `am` · `reset` · `clean` · `restore` · `apply` · `update-ref` · `filter-branch` ·
`checkout -- <path>` · `stash drop|clear|pop` · `branch -D|-d|--delete` · `tag -d|--delete`.

Wider than "commit, merge, push" on purpose: `reset --hard`, `clean -fd` and
`checkout -- .` destroy uncommitted work just as permanently, and there is no undo.

**Runs without a prompt** (reads only): `status` · `diff` · `log` · `show` · `branch`
(listing) · `remote` · `fetch` · `rev-parse` · `ls-files` · `blame` · `describe` ·
`shortlog` · `reflog` · `stash list` · `tag` (listing) · `checkout <branch>` ·
`checkout -b <branch>`.

**Denied outright, never prompted:** any `commit`/`merge`/`push` while on `main`, and any
push naming `main`/`master`.

`npm` / `npx` — **not gated.** They run without a prompt.
