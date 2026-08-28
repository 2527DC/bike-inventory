#!/usr/bin/env node
// Keeps docs/implementation in order.
//
// Two jobs:
//   1. When a plan under pending/ has its status line flipped to `completed`, move the file
//      to completed/.
//   2. Regenerate the two tables in docs/implementation/README.md from what is on disk.
//
// Invoked three ways:
//   node plan-status.cjs --hook          reads the hook payload JSON on stdin
//   node plan-status.cjs <file.md>       acts on one file (used by /ship-plan)
//   node plan-status.cjs --sync          only regenerates the README
//
// WHY A STRICT STATUS TOKEN: before this existed every plan wrote its status as free prose
// ("PLAN ONLY — not implemented", "plan, plus the RBAC groundwork already seeded"), which
// no script can classify. The first word after `Status:` must now be one of three tokens.
// Everything after an em-dash is free text and ignored by the parser.

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const IMPL = path.join(ROOT, "docs", "implementation");
const PENDING = path.join(IMPL, "pending");
const COMPLETED = path.join(IMPL, "completed");
const README = path.join(IMPL, "README.md");

const STATES = ["pending", "in-progress", "completed"];

/** The status token from a plan file, or null when it has no parseable one. */
function readStatus(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  // Only the head of the file — a "Status:" mentioned in prose further down is not the
  // document's own status.
  for (const raw of text.split("\n").slice(0, 15)) {
    const line = raw.replace(/[*`_]/g, "").trim();
    const m = /^Status:\s*([a-z-]+)/i.exec(line);
    if (m) {
      const token = m[1].toLowerCase();
      return STATES.includes(token) ? token : null;
    }
  }
  return null;
}

/**
 * The free text after the status token, for the README table.
 *
 * Detection strips markdown so a bolded `**Status:**` is still recognised, but the note is
 * taken from the ORIGINAL line. Stripping the note too would eat the asterisks and
 * underscores inside real content — `/services/*` became `/services/` and `SERVICE_*`
 * became `SERVICE` before this split.
 */
function readNote(file) {
  try {
    for (const raw of fs.readFileSync(file, "utf8").split("\n").slice(0, 15)) {
      const probe = raw.replace(/[*`_]/g, "").trim();
      if (!/^Status:\s*[a-z-]+/i.test(probe)) continue;
      const m = /^\**Status:\**\s*[a-z-]+\s*[—-]{1,2}\s*(.+)$/i.exec(raw.trim());
      return m ? m[1].trim() : "";
    }
  } catch {
    /* unreadable file — the caller already reports it */
  }
  return "";
}

/** Existing descriptions, so hand-written notes in the README survive a regeneration. */
function existingDescriptions() {
  const map = new Map();
  if (!fs.existsSync(README)) return map;
  for (const line of fs.readFileSync(README, "utf8").split("\n")) {
    const m = /^\|\s*`([^`]+\.md)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function listPlans(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

function table(dir, heading, descriptions) {
  const rows = listPlans(dir).map((name) => {
    const note = descriptions.get(name) || readNote(path.join(dir, name)) || "—";
    return `| \`${name}\` | ${note} |`;
  });
  return [`| Plan | ${heading} |`, "|---|---|", ...(rows.length ? rows : ["| _none_ |  |"])].join("\n");
}

/**
 * Rewrite the two tables between marker comments.
 *
 * Markers rather than whole-file generation on purpose: the README also carries prose and a
 * caveat section that a human wrote and a script has no business touching.
 */
function syncReadme() {
  if (!fs.existsSync(README)) return false;
  let text = fs.readFileSync(README, "utf8");
  const before = text;
  const descriptions = existingDescriptions();

  const blocks = {
    completed: table(COMPLETED, "Shipped", descriptions),
    pending: table(PENDING, "State", descriptions),
  };

  for (const [key, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- BEGIN:${key} -->\\n)[\\s\\S]*?(\\n<!-- END:${key} -->)`);
    if (!re.test(text)) {
      console.error(`plan-status: README is missing the <!-- BEGIN:${key} --> marker; skipped.`);
      continue;
    }
    text = text.replace(re, `$1${body}$2`);
  }

  if (text !== before) {
    fs.writeFileSync(README, text);
    return true;
  }
  return false;
}

/** Move a completed plan out of pending/. Returns a message, or null when nothing was done. */
function promoteIfCompleted(file) {
  const abs = path.resolve(file);
  if (!abs.startsWith(PENDING + path.sep)) return null; // not a pending plan
  if (readStatus(abs) !== "completed") return null;

  const target = path.join(COMPLETED, path.basename(abs));
  if (fs.existsSync(target)) {
    return `plan-status: ${path.basename(abs)} is marked completed but already exists in completed/. Left in place — resolve by hand.`;
  }
  fs.mkdirSync(COMPLETED, { recursive: true });
  fs.renameSync(abs, target);
  return `Moved ${path.basename(abs)} to docs/implementation/completed/ (status is now "completed").`;
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--sync") {
    console.log(syncReadme() ? "README tables updated." : "README already up to date.");
    return;
  }

  if (args[0] === "--hook") {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let file = "";
      try {
        const payload = JSON.parse(raw);
        file = payload?.tool_input?.file_path || payload?.tool_response?.filePath || "";
      } catch {
        /* malformed payload — nothing to act on, and blocking the turn over it would be worse */
      }
      if (!file) return;

      const moved = promoteIfCompleted(file);
      const synced = syncReadme();
      if (moved || synced) {
        // systemMessage surfaces in the UI so the move is never silent.
        process.stdout.write(
          JSON.stringify({
            systemMessage: moved || "docs/implementation/README.md tables refreshed.",
          })
        );
      }
    });
    return;
  }

  // Explicit path mode, used by /ship-plan.
  const file = args[0];
  if (!file) {
    console.error("usage: plan-status.cjs <file.md> | --sync | --hook");
    process.exit(2);
  }
  const status = readStatus(file);
  if (!status) {
    console.error(
      `plan-status: ${path.basename(file)} has no parseable status line.\n` +
        `Add one of these as a line near the top:\n` +
        `  Status: pending\n  Status: in-progress\n  Status: completed — <date and one-line summary>`
    );
    process.exit(1);
  }
  const moved = promoteIfCompleted(file);
  const synced = syncReadme();
  console.log(moved || `Status is "${status}" — left in place.`);
  if (synced) console.log("README tables updated.");
}

main();
