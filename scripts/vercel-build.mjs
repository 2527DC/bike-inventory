// Vercel build command: apply migrations, generate the client, then build.
//
//   prisma migrate deploy  ->  prisma generate  ->  next build
//
// Why the migrate step lives in the build rather than in a runbook: `main` deploys
// automatically, so there is no moment between "merge" and "new code is live" in which a human
// could run migrations by hand. Putting it here makes a failed migration a FAILED BUILD — the
// deployment does not happen and the previous one keeps serving. That is the desired failure
// mode: no deploy is far better than new code against an old schema.
//
// `migrate deploy` is the only Prisma command that may touch a non-local database. It never
// creates a shadow database, never resets, and only applies migration folders that are already
// committed. It reads DIRECT_URL (the 5432 session pooler) via `directUrl` in the datasource
// block — Migrate takes a session lock, and a transaction pooler on 6543 never releases it.
//
// Every applied folder is printed by Prisma itself, so the build log is the audit trail of what
// reached the database and when.
//
// Wired as "buildCommand" in vercel.json.

import { spawnSync } from "node:child_process";

const steps = [
  ["prisma migrate deploy", "applying migrations"],
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

console.log("\nbuild complete: migrations applied, client generated, app built.");
