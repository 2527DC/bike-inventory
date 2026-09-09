#!/usr/bin/env node
// PreToolUse guard: implementation plans belong in docs/implementation/, and a new plan
// opens with its requirements.
//
// Two checks, both deterministic — a path check and a heading check, not an LLM judgement.
// No latency, no cost, and neither can decide differently on two identical inputs.
//
// 1. PLACEMENT. Blocks writing a *-plan.md anywhere under docs/ except
//    docs/implementation/{pending,completed}/. Prevention rather than tidying up afterwards
//    — a plan written to the wrong place is usually only noticed weeks later, by which time
//    links point at it.
//
// 2. REQUIREMENT FIRST. Blocks writing a NEW plan whose first section is not the
//    requirement. Owner's instruction, 8 Sep 2026 and again 9 Sep: a plan is not an
//    implementation note with a requirement pasted somewhere in it. It opens with what was
//    asked — verbatim — restated as numbered R1…Rn, so the next reader can check the build
//    against the ask instead of inferring the ask from the build. The full section order is
//    in docs/implementation/README.md, "The requirement comes first".
//
//    Only NEW files are checked. Editing or rewriting a plan that already exists is not
//    blocked — every plan written before this convention would otherwise become unwritable,
//    and the rule is about how a plan STARTS.
//
// Reference documents (data-flow-and-modules.md, dead-code.md, schema-review.md) are NOT
// plans and are unaffected by either check — the filename must contain "plan" to be caught.

const fs = require("fs");

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file = "";
  let content = "";
  try {
    const input = JSON.parse(raw)?.tool_input || {};
    file = input.file_path || "";
    content = typeof input.content === "string" ? input.content : "";
  } catch {
    // Malformed payload: allow. A guard that blocks on its own parse failure would be a
    // worse bug than the one it prevents.
    return;
  }
  if (!file) return;

  const p = file.replace(/\\/g, "/");
  const isPlan = /\/docs\/.*plan[^/]*\.md$/i.test(p);
  if (!isPlan) return;

  const name = p.split("/").pop();
  const inPlace = /\/docs\/implementation\/(pending|completed)\//i.test(p);

  if (!inPlace) {
    return deny(
      `Implementation plans live in docs/implementation/. Write it to ` +
        `docs/implementation/pending/${name} instead, and give it a status line whose ` +
        `first word is one of: pending | in-progress | completed. ` +
        `See docs/implementation/README.md. ` +
        `(If this is a reference document rather than a plan, rename it so the filename ` +
        `does not contain "plan".)`
    );
  }

  // From here: a plan, in the right place. Only a NEW one is held to the section order.
  let exists = false;
  try {
    exists = fs.existsSync(file);
  } catch {
    // Cannot stat: treat as existing, i.e. allow. Same reasoning as the parse failure above.
    return;
  }
  if (exists || !content) return;

  // The first section heading must be the requirement, and that section must LIST them.
  // Both halves matter: a heading with a wall of prose under it is not something anyone can
  // check a build against line by line.
  //
  // The list may be `R1…Rn` (the README's shape, and what the deny message recommends) or a
  // plain numbered list. Insisting on the `R1` token alone would refuse
  // `0909-transfer-mode-and-document-attachment-plan.md`, which quotes the owner verbatim and
  // then numbers the reading 1–7 — compliant in every way that matters.
  const lines = content.split(/\r?\n/);
  const headings = [];
  lines.forEach((l, i) => {
    const m = /^\s{0,3}(#{2,4})\s+\S/.exec(l);
    if (m) headings.push({ i, level: m[1].length });
  });
  const first = headings[0];
  const firstHeading = first ? lines[first.i].trim() : "";
  const opensWithRequirement = /requirement/i.test(firstHeading);

  // The opening section runs to the next heading at the SAME level or higher — its own
  // subsections belong to it. `0909-transfer-mode` quotes the owner under `## 1. The
  // requirement, verbatim` and numbers the reading under a `### How I read it` beneath it.
  const next = first
    ? headings.find((h) => h.i > first.i && h.level <= first.level)
    : undefined;
  const openingSection = first
    ? lines.slice(first.i + 1, next ? next.i : lines.length).join("\n")
    : "";
  const hasNumbered =
    /(^|[\s*`|(])R1\b/m.test(openingSection) || /^\s{0,3}\d+[.)]\s+\S/m.test(openingSection);

  if (!opensWithRequirement || !hasNumbered) {
    const found = firstHeading || "(no section heading at all)";
    return deny(
      `${name} does not open with its requirements.\n` +
        (opensWithRequirement ? "" : `  First section is: ${found}\n`) +
        (hasNumbered
          ? ""
          : `  The opening section lists nothing — no R1…Rn and no numbered list.\n`) +
        `\nA plan opens with §0 Requirement — the owner's words VERBATIM, then restated as ` +
        `numbered R1…Rn — before any questions, any file:line reading of the code, and any ` +
        `implementation. Then §1 Questions and clarifications, §2 How it works today, ` +
        `§3 Implementation plan, §4 Verification, §5 Out of scope.\n` +
        `See docs/implementation/README.md, "The requirement comes first"; ` +
        `docs/implementation/completed/0809-brand-category-inactive-and-audit-approval-plan.md ` +
        `is the shape to copy.`
    );
  }
});
