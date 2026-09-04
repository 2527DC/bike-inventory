// Refuse to run a destructive Prisma command against anything that is not localhost.
//
// `prisma migrate dev` creates a shadow database and can reset the target. Run it against the
// Supabase URL by accident — because .env was left pointing there after a debugging session —
// and it tries to create a shadow database on a cloud project, or resets one.
//
// This is gated here rather than trusted to discipline: .env has already pointed at both
// localhost and the Supabase pooler on different days of the same week.
//
// Wired into package.json as the first half of `db:migrate`, so the check runs itself.
// Prints hostnames only, never a URL.

import { readFileSync } from "node:fs";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
const KEYS = ["DATABASE_URL", "DIRECT_URL"];

let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  console.error("assert-localhost: .env not found — run this from the project root.");
  process.exit(1);
}

const bad = [];
for (const key of KEYS) {
  const m = env.match(new RegExp(`^${key}="?([^"\\n]+)`, "m"));
  if (!m) {
    // DIRECT_URL is optional in principle; DATABASE_URL is not.
    if (key === "DATABASE_URL") {
      console.error(`assert-localhost: ${key} is not set in .env`);
      process.exit(1);
    }
    continue;
  }
  let host;
  try {
    host = new URL(m[1]).hostname;
  } catch {
    console.error(`assert-localhost: ${key} is not a valid URL`);
    process.exit(1);
  }
  console.log(`${key} -> ${host}`);
  if (!LOCAL_HOSTS.includes(host)) bad.push(`${key} -> ${host}`);
}

if (bad.length > 0) {
  console.error("\nrefusing to run: these are not localhost\n  " + bad.join("\n  "));
  console.error(
    "\n`prisma migrate dev` creates a shadow database and can reset the target." +
      "\nPoint .env at localhost:5432/bch first. Production and test are written only by" +
      "\n`prisma migrate deploy` from the Vercel build.",
  );
  process.exit(1);
}
