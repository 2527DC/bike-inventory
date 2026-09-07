// Vercel build command: generate the client, then build.
//
//   prisma generate  ->  next build
//
// ─── MIGRATIONS ARE NOT APPLIED BY THIS BUILD (owner, 7 Sep 2026) ────────────────────────
//
// `prisma migrate deploy` used to run as the FIRST step here. It was removed on the owner's
// instruction. Nothing else replaced it, so read this before assuming a deploy updates the
// schema:
//
//   * The deployed database is NOT migrated by deploying. A migration folder that is
//     committed but never applied means new code meets an old schema, which fails at the
//     first query against a missing column rather than at build time.
//   * The old arrangement made a failed migration a FAILED BUILD, so no deploy happened and
//     the previous deployment kept serving. That protection is gone with it: the build now
//     succeeds regardless of what the database looks like.
//   * Whoever deploys therefore has to apply migrations themselves, against the target
//     database, BEFORE the new code goes live:
//
//         npx prisma migrate status     # what is pending
//         npx prisma migrate deploy     # apply it
//
//     `migrate deploy` is still the only Prisma command that may touch a non-local database.
//     It never creates a shadow database, never resets, and only applies folders already
//     committed. It reads DIRECT_URL (the 5432 session pooler) via `directUrl` in the
//     datasource block — Migrate takes a session lock, and a transaction pooler on 6543
//     never releases it.
//
// TO RESTORE: put ["prisma migrate deploy", "applying migrations"] back as the first entry
// of `steps` below. The failure handling for it is still in place further down.
//
// Wired as "buildCommand" in vercel.json.

import { spawnSync } from "node:child_process";

const steps = [
  ["prisma generate", "generating the Prisma client"],
  ["next build", "building the app"],
];

for (const [cmd, label] of steps) {
  console.log(`\n=== ${label}: ${cmd} ===`);
  const started = Date.now();
  // shell: true so this works with the local npx shim on Windows as well as on Vercel's Linux.
  const r = spawnSync(`npx ${cmd}`, { stdio: "inherit", shell: true });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (r.error) {
    console.error(`\n${cmd} could not be started: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n${cmd} failed with exit code ${r.status} after ${secs}s — build aborted.`);
    if (cmd.startsWith("prisma migrate")) {
      console.error(
        "A migration did not apply. NOTHING is deployed and the previous deployment keeps\n" +
          "serving. Check `npx prisma migrate status` against this environment before retrying.",
      );
    }
    process.exit(r.status ?? 1);
  }
  console.log(`=== ${label}: ok (${secs}s) ===`);
}

console.log("\nbuild complete: client generated, app built. NO migrations were applied.");
