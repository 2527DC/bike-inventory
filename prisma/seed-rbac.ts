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
  // ── 0. Validate the module tree BEFORE writing anything ────────────────────
  // Module.parentId is a self-referencing FK, and a foreign key cannot express any of the
  // rules below. Each one fails SILENTLY rather than loudly, which is why they are asserted
  // here and not left to review:
  //   - an unknown parentKey would leave a child stranded as a root
  //   - a grandchild would exist in the database and render NOWHERE (the sidebar walks
  //     exactly two levels), so the grant works and the link never appears
  //   - a cycle satisfies the FK and hangs a recursive nav builder
  //   - a child with its own `group` gives the sidebar two competing grouping mechanisms
  //     and renders the section twice
  const catalogByKey = new Map(MODULE_CATALOG.map((m) => [m.key, m]));
  for (const m of MODULE_CATALOG) {
    if (!m.parentKey) continue;
    const parent = catalogByKey.get(m.parentKey);
    if (!parent) {
      throw new Error(`module "${m.key}": parentKey "${m.parentKey}" is not in MODULE_CATALOG`);
    }
    if (parent.parentKey) {
      throw new Error(
        `module "${m.key}": parent "${m.parentKey}" is itself a child. The sidebar renders ` +
          `exactly two levels, so a grandchild would exist in the DB and appear nowhere.`
      );
    }
    if (m.key === m.parentKey) {
      throw new Error(`module "${m.key}": cannot be its own parent`);
    }
    if (m.group !== parent.group) {
      throw new Error(
        `module "${m.key}": group "${m.group}" differs from parent "${m.parentKey}" ` +
          `("${parent.group}"). A child inherits its parent's group; two groupings render twice.`
      );
    }
  }

  // ── 1. Modules — roots first, then children ────────────────────────────────
  // TWO PASSES, and the order is load-bearing: a child upserted before its parent exists
  // has no id to point at. `parentId` appears in BOTH create and update, so a row someone
  // re-parented by hand is restored on the next seed — the same reasoning the existing
  // upsert applies to label, route and sortOrder.
  const roots = MODULE_CATALOG.filter((m) => !m.parentKey);
  const children = MODULE_CATALOG.filter((m) => m.parentKey);

  for (const m of roots) {
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
        parentId: null,
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

  // Re-read after the roots exist so every parentKey resolves.
  let moduleIdByKey = new Map(
    (await prisma.module.findMany({ select: { id: true, key: true } })).map((m) => [m.key, m.id])
  );

  for (const m of children) {
    const parentId = moduleIdByKey.get(m.parentKey!);
    if (!parentId) throw new Error(`module "${m.key}": parent "${m.parentKey}" was not created`);

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
        parentId,
      },
      create: {
        key: m.key,
        label: m.label,
        description: m.description,
        icon: m.icon,
        route: m.route,
        group: m.group,
        sortOrder: m.sortOrder,
        parentId,
      },
    });
  }
  console.log(
    `  modules      : ${MODULE_CATALOG.length} synced (${roots.length} root, ${children.length} child)`
  );

  // Drop modules that no longer exist in the catalog. Cascades to their permissions
  // and to any role grants pointing at them.
  //
  // CHILDREN FIRST — not cosmetic. Module.parentId is onDelete: Restrict, so deleting a
  // parent while any row still points at it raises a foreign-key violation. A single
  // deleteMany covering both would fail HERE: after the upserts above, before permissions
  // are synced, leaving RBAC half-applied with an error naming a constraint, not a cause.
  const liveKeys = MODULE_CATALOG.map((m) => m.key);
  const staleChildren = await prisma.module.deleteMany({
    where: { key: { notIn: liveKeys }, parentId: { not: null } },
  });
  const staleRoots = await prisma.module.deleteMany({
    where: { key: { notIn: liveKeys } },
  });
  const staleModules = { count: staleChildren.count + staleRoots.count };
  if (staleModules.count) console.log(`  modules      : ${staleModules.count} stale removed`);

  // Re-read once more: the stale deletes above may have removed rows the first read held.
  moduleIdByKey = new Map(
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
