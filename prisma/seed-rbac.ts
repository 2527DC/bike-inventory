// ─── RBAC seed ───────────────────────────────────────────────────────────────
// Populates modules, permissions, the ADMIN role (holding every permission) and the
// single admin user.
//
// Idempotent: safe to re-run after adding a module or action to prisma/rbac-catalog.ts.
// Re-running syncs the catalog into the DB, re-grants the full set to ADMIN, and leaves
// every other role's grants untouched.
//
//   npm run db:seed:rbac
//
// Admin credentials are env-overridable. The access code IS the login credential — it is
// stored bcrypt-hashed in `password` (see src/lib/auth.ts).
//
//   ADMIN_NAME         default "Administrator"
//   ADMIN_EMAIL        default "admin@bch.local"
//   ADMIN_ACCESS_CODE  default "ADMIN123"   <-- change this before any real use

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  MODULE_CATALOG,
  ROLE_CATALOG,
  allPermissionSeeds,
  roleGrantKeys,
  ACTION_LABELS,
} from "./rbac-catalog";

const ADMIN_ROLE_KEY = "ADMIN";

export async function seedRbac(prisma: PrismaClient) {
  // ── 1. Modules ─────────────────────────────────────────────────────────────
  for (const m of MODULE_CATALOG) {
    await prisma.module.upsert({
      where: { key: m.key },
      update: {
        label: m.label,
        description: m.description,
        icon: m.icon,
        route: m.route,
        group: m.group,
        sortOrder: m.sortOrder,
        isActive: true,
      },
      create: {
        key: m.key,
        label: m.label,
        description: m.description,
        icon: m.icon,
        route: m.route,
        group: m.group,
        sortOrder: m.sortOrder,
      },
    });
  }
  console.log(`  modules      : ${MODULE_CATALOG.length} synced`);

  // Drop modules that no longer exist in the catalog. Cascades to their permissions
  // and to any role grants pointing at them.
  const staleModules = await prisma.module.deleteMany({
    where: { key: { notIn: MODULE_CATALOG.map((m) => m.key) } },
  });
  if (staleModules.count) console.log(`  modules      : ${staleModules.count} stale removed`);

  const moduleIdByKey = new Map(
    (await prisma.module.findMany({ select: { id: true, key: true } })).map((m) => [m.key, m.id])
  );

  // ── 2. Permissions (one row per module × action) ───────────────────────────
  const permSeeds = allPermissionSeeds();
  for (const p of permSeeds) {
    const moduleId = moduleIdByKey.get(p.moduleKey)!;
    await prisma.permission.upsert({
      where: { moduleId_action: { moduleId, action: p.action } },
      update: { key: p.key, label: p.label },
      create: { moduleId, action: p.action, key: p.key, label: p.label },
    });
  }
  console.log(`  permissions  : ${permSeeds.length} synced`);

  const stalePerms = await prisma.permission.deleteMany({
    where: { key: { notIn: permSeeds.map((p) => p.key) } },
  });
  if (stalePerms.count) console.log(`  permissions  : ${stalePerms.count} stale removed`);

  // ── 3. ADMIN role ──────────────────────────────────────────────────────────
  const adminRole = await prisma.role.upsert({
    where: { key: ADMIN_ROLE_KEY },
    update: { isSystem: true, isActive: true },
    create: {
      key: ADMIN_ROLE_KEY,
      name: "Administrator",
      description: "Full access to every module and action. Cannot be deleted.",
      isSystem: true,
    },
  });

  // ── 4. Grant every permission to ADMIN ─────────────────────────────────────
  // A RolePermission row's existence IS the grant, so this is a pure insert of the
  // ones not already present.
  const allPerms = await prisma.permission.findMany({ select: { id: true } });
  const held = new Set(
    (
      await prisma.rolePermission.findMany({
        where: { roleId: adminRole.id },
        select: { permissionId: true },
      })
    ).map((rp) => rp.permissionId)
  );
  const missing = allPerms.filter((p) => !held.has(p.id));
  if (missing.length) {
    await prisma.rolePermission.createMany({
      data: missing.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`  ADMIN role   : ${allPerms.length} permissions granted (${missing.length} new)`);

  // ── 5. Default roles, seeded WITH their grants ─────────────────────────────
  // Deliberately create-only. If the role already exists, its grants are left exactly as
  // they are — an admin who tightened or widened a role in the UI must not have that
  // silently reverted the next time someone runs the seed. ADMIN above is the sole
  // exception, because it must never be able to lock itself out.
  const permIdByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
      p.key,
      p.id,
    ])
  );

  let rolesCreated = 0;
  let rolesSkipped = 0;

  for (const seed of ROLE_CATALOG) {
    const existing = await prisma.role.findUnique({
      where: { key: seed.key },
      select: { id: true },
    });

    if (existing) {
      rolesSkipped++;
      continue;
    }

    const wanted = roleGrantKeys(seed);
    const ids = wanted.map((k) => permIdByKey.get(k)).filter((id): id is string => !!id);

    const missing = wanted.filter((k) => !permIdByKey.has(k));
    if (missing.length) {
      console.warn(`  ! ${seed.key}: no such permission(s): ${missing.join(", ")}`);
    }

    await prisma.role.create({
      data: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        isSystem: false, // editable and deletable, unlike ADMIN
        permissions: { create: ids.map((permissionId) => ({ permissionId })) },
      },
    });
    rolesCreated++;
    console.log(`  role         : ${seed.key} created with ${ids.length} permissions`);
  }
  console.log(
    `  roles        : ${rolesCreated} created, ${rolesSkipped} left untouched (already existed)`
  );

  // ── 6. The single admin user ───────────────────────────────────────────────
  const name = process.env.ADMIN_NAME || "Administrator";
  const email = (process.env.ADMIN_EMAIL || "admin@bch.local").toLowerCase();
  const accessCode = (process.env.ADMIN_ACCESS_CODE || "ADMIN123").toUpperCase();
  const password = await bcrypt.hash(accessCode, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, roleId: adminRole.id, accessCode, password, isActive: true },
    create: { name, email, accessCode, password, roleId: adminRole.id },
  });
  console.log(`  admin user   : ${admin.email}  (access code: ${accessCode})`);

  return { adminRole, admin };
}

// Allow running this file directly: `npm run db:seed:rbac`
if (require.main === module) {
  const prisma = new PrismaClient();
  console.log("Seeding RBAC...");
  seedRbac(prisma)
    .then(() => {
      console.log("\nRBAC seed complete.");
      const actions = Object.keys(ACTION_LABELS).join(", ");
      console.log(`Actions in use: ${actions}`);
    })
    .catch((e) => {
      console.error("RBAC seed failed:", e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
