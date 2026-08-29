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

## git and npm commands: ALWAYS ask first

Claude must never run a `git` or `npm` command on its own initiative. Every one of
them is gated by an `ask` permission rule in `.claude/settings.json`, so a prompt
appears with the exact command before anything runs.

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
`git` — every subcommand, including read-only ones (`status`, `diff`, `log`).
`npm` — every subcommand, including `npm run build`, `npm install`, `npx`-style scripts.
