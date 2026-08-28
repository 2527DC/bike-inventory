---
description: Mark an implementation plan completed, move it to docs/implementation/completed/, and refresh the README
argument-hint: <plan-filename> [one-line summary of what shipped]
---

Mark an implementation plan as completed and file it.

Target: `$ARGUMENTS`

Do this in order, and stop at the first step that fails rather than pressing on:

1. **Find the plan.** Look in `docs/implementation/pending/`. If the argument is not an
   exact filename, match on a substring; if more than one file matches, list them and ask
   which — do not guess.

   If it is already in `completed/`, say so and stop. Nothing to do.

2. **Verify it actually shipped.** Do not take the request at face value. Read the plan's
   own verification section and check the claims against the code — the files it says it
   would create should exist, the ones it says it would delete should be gone.

   If the evidence does not support "completed", **say so and stop.** A plan filed as done
   when it is not is worse than one left pending: the next reader trusts the folder. Offer
   `in-progress` instead, and note what is outstanding.

3. **Rewrite the status line** to the strict form, replacing whatever is there:

   ```
   Status: completed — <today's date>, <one line on what shipped>
   ```

   The first word after `Status:` must be exactly `completed`. Everything after the em-dash
   is free text. Use the summary from `$ARGUMENTS` if one was given.

   Editing the file under `docs/implementation/` fires the PostToolUse hook, which performs
   the move and refreshes the README automatically. If for any reason it does not fire, run
   it by hand:

   ```
   node .claude/hooks/plan-status.cjs docs/implementation/pending/<file>.md
   ```

4. **Check the README.** The plan should now appear under `completed/` with a sensible
   description and be gone from `pending/`. Correct the description if the generated one
   reads poorly — hand-written descriptions survive regeneration.

5. **Report, do not commit.** Tell the user what moved and what the README now says, then
   propose the `git add` / `git commit` commands for them to run. Committing is theirs.

Notes:

- Only `pending`, `in-progress` and `completed` are valid status tokens.
- If the plan shipped only partially, `in-progress` with a note on what remains is the
  honest answer — `ledger-merge-plan.md` is the example already in the tree.
