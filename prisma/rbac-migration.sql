-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: enum Role  ->  dynamic RBAC tables
--
-- WHEN DO I NEED THIS FILE?
--   * Database is EMPTY / disposable  -> you do NOT need this. Just run:
--         npm run db:push && npm run db:seed:rbac
--   * Database has REAL USERS         -> run THIS FILE FIRST, then `npm run db:push`
--         (push will then be a no-op because the schema already matches), then
--         `npm run db:seed:rbac` to fill in modules, permissions and the ADMIN grants.
--
-- WHY: `users.role` is a Postgres enum column. The new schema replaces it with
-- `users."roleId"`, a NOT NULL foreign key. Adding a NOT NULL column to a table that
-- already has rows fails unless the values are backfilled first — which is exactly what
-- this script does, inside a single transaction, without losing a single account.
--
-- HOW TO RUN:
--   psql "$DATABASE_URL" -f prisma/rbac-migration.sql
--
-- SAFETY: the whole thing is one transaction. If any statement fails, nothing is applied.
-- Take a backup first anyway — this drops columns.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. New tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "modules" (
    "id"          TEXT         NOT NULL,
    "key"         TEXT         NOT NULL,
    "label"       TEXT         NOT NULL,
    "description" TEXT,
    "icon"        TEXT,
    "route"       TEXT,
    "group"       TEXT,
    "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "modules_key_key"            ON "modules" ("key");
CREATE        INDEX IF NOT EXISTS "modules_isActive_sortOrder_idx" ON "modules" ("isActive", "sortOrder");

CREATE TABLE IF NOT EXISTS "permissions" (
    "id"          TEXT         NOT NULL,
    "key"         TEXT         NOT NULL,
    "moduleId"    TEXT         NOT NULL,
    "action"      TEXT         NOT NULL,
    "label"       TEXT         NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_key"               ON "permissions" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_moduleId_action_key"   ON "permissions" ("moduleId", "action");
CREATE        INDEX IF NOT EXISTS "permissions_moduleId_idx"          ON "permissions" ("moduleId");

CREATE TABLE IF NOT EXISTS "roles" (
    "id"          TEXT         NOT NULL,
    "key"         TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "description" TEXT,
    "isSystem"    BOOLEAN      NOT NULL DEFAULT false,
    "isActive"    BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "roles_key_key"      ON "roles" ("key");
CREATE        INDEX IF NOT EXISTS "roles_isActive_idx" ON "roles" ("isActive");

CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id"           TEXT         NOT NULL,
    "roleId"       TEXT         NOT NULL,
    "permissionId" TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_roleId_permissionId_key" ON "role_permissions" ("roleId", "permissionId");
CREATE        INDEX IF NOT EXISTS "role_permissions_roleId_idx"              ON "role_permissions" ("roleId");
CREATE        INDEX IF NOT EXISTS "role_permissions_permissionId_idx"        ON "role_permissions" ("permissionId");

-- Foreign keys (added separately so re-running against a partial state is tolerable).
DO $$ BEGIN
    ALTER TABLE "permissions"
        ADD CONSTRAINT "permissions_moduleId_fkey"
        FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "role_permissions"
        ADD CONSTRAINT "role_permissions_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "role_permissions"
        ADD CONSTRAINT "role_permissions_permissionId_fkey"
        FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 2. Create one role row per role value currently in use ───────────────────
-- Every distinct value found in users.role becomes a real role. Nobody is stranded.
-- ADMIN is marked isSystem so the app refuses to delete it later.

INSERT INTO "roles" ("id", "key", "name", "description", "isSystem", "isActive", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    u.role::text,
    initcap(replace(lower(u.role::text), '_', ' ')),
    'Migrated from the legacy Role enum.',
    (u.role::text = 'ADMIN'),
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT role FROM "User") u
ON CONFLICT ("key") DO NOTHING;

-- Guarantee ADMIN exists even if no user currently holds it.
INSERT INTO "roles" ("id", "key", "name", "description", "isSystem", "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'ADMIN', 'Administrator',
        'Full access to every module and every action. Cannot be deleted.',
        true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;


-- ── 3. Point every user at their new role ────────────────────────────────────

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roleId" TEXT;

UPDATE "User" u
   SET "roleId" = r."id"
  FROM "roles" r
 WHERE r."key" = u.role::text
   AND u."roleId" IS NULL;

-- Anything still unmatched (shouldn't happen) falls back to ADMIN rather than
-- being left NOT NULL-violating and blocking the migration.
UPDATE "User" u
   SET "roleId" = (SELECT "id" FROM "roles" WHERE "key" = 'ADMIN')
 WHERE u."roleId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

DO $$ BEGIN
    ALTER TABLE "User"
        ADD CONSTRAINT "User_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "User_roleId_idx" ON "User" ("roleId");


-- ── 4. Drop the replaced columns and the enum ────────────────────────────────
-- users.permissions and AlertConfig.rolePermissions held the old JSON permission
-- blobs; role_permissions replaces both. customRoleName is obsolete now that a role
-- carries its own display name.

ALTER TABLE "User"        DROP COLUMN IF EXISTS "role";
ALTER TABLE "User"        DROP COLUMN IF EXISTS "permissions";
ALTER TABLE "User"        DROP COLUMN IF EXISTS "customRoleName";
ALTER TABLE "AlertConfig" DROP COLUMN IF EXISTS "rolePermissions";

DROP TYPE IF EXISTS "Role";

COMMIT;

-- ── NEXT STEPS ───────────────────────────────────────────────────────────────
--   1. npm run db:push        -- should report "already in sync"
--   2. npm run db:seed:rbac   -- creates modules, permissions and grants ADMIN everything
--
-- Roles migrated from the old enum start with ZERO permissions (only ADMIN is granted
-- everything). Open /team/permissions as the admin and grant each role what it needs.
-- ─────────────────────────────────────────────────────────────────────────────
