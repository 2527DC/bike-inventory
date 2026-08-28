#!/usr/bin/env node
// PreToolUse guard: implementation plans belong in docs/implementation/.
//
// Blocks writing a *-plan.md anywhere under docs/ except docs/implementation/{pending,
// completed}/. Prevention rather than tidying up afterwards — a plan written to the wrong
// place is usually only noticed weeks later, by which time links point at it.
//
// Deterministic on purpose: a path check, not an LLM judgement. No latency, no cost, and it
// cannot decide differently on two identical inputs.
//
// Reference documents (data-flow-and-modules.md, dead-code.md, schema-review.md) are NOT
// plans and are unaffected — the filename must contain "plan" to be caught.

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file = "";
  try {
    file = JSON.parse(raw)?.tool_input?.file_path || "";
  } catch {
    // Malformed payload: allow. A guard that blocks on its own parse failure would be a
    // worse bug than the one it prevents.
    return;
  }
  if (!file) return;

  const p = file.replace(/\\/g, "/");
  const isPlan = /\/docs\/.*plan[^/]*\.md$/i.test(p);
  const inPlace = /\/docs\/implementation\/(pending|completed)\//i.test(p);

  if (isPlan && !inPlace) {
    const name = p.split("/").pop();
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `Implementation plans live in docs/implementation/. Write it to ` +
            `docs/implementation/pending/${name} instead, and give it a status line whose ` +
            `first word is one of: pending | in-progress | completed. ` +
            `See docs/implementation/README.md. ` +
            `(If this is a reference document rather than a plan, rename it so the filename ` +
            `does not contain "plan".)`,
        },
      })
    );
  }
});
