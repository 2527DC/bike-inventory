import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

// Structural types for the callback arguments.
//
// next-auth v4 does not re-export Session / User / JWT in a form this project's
// "bundler" module resolution can read, and `declare module "next-auth"` augmentation
// shadows the package's real types rather than merging with them (it degrades Session to
// `{}` across the codebase). Describing only the fields we touch keeps the callbacks
// type-checked without fighting the package's type layout.
type AppToken = {
  userId?: string;
  roleKey?: string;
  roleName?: string;
  [claim: string]: unknown;
};

type AppAuthUser = { id: string; roleKey?: string; roleName?: string };

// Mirrors next-auth's DefaultSession field-for-field. It must be compatible in BOTH
// directions: next-auth passes its `Session` *in* (so this may not demand anything Session
// lacks -- an index signature here failed the build, because `Session` is an interface and
// interfaces never get an implicit one), and we hand the object *back* (so it may not drop
// the required `expires` or widen `user` to null).
type AppSession = {
  user?: { name?: string | null; email?: string | null; image?: string | null; [k: string]: unknown };
  expires: string;
};

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Access Code",
      credentials: {
        accessCode: { label: "Access Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.accessCode) return null;

        const code = credentials.accessCode.trim().toUpperCase();

        const user = await prisma.user.findUnique({
          where: { accessCode: code },
          select: {
            id: true,
            name: true,
            email: true,
            password: true,
            isActive: true,
            role: { select: { key: true, name: true, isActive: true } },
          },
        });

        if (!user || !user.isActive || !user.role?.isActive) {
          // Run bcrypt against a dummy hash so a missing/inactive account takes the same
          // time as a wrong code, preventing user enumeration by timing.
          await bcrypt.compare(code, "$2b$10$dummyhashvaluetopreventtimingattacks");
          return null;
        }

        const isValid = await bcrypt.compare(code, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          roleKey: user.role.key,
          roleName: user.role.name,
        };
      },
    }),
  ],
  callbacks: {
    // Runs at sign-in (with `user`) AND on every session read (without it) — with the JWT
    // strategy, next-auth invokes this callback each time the cookie is decoded. So
    // anything done here happens on EVERY authenticated request.
    //
    // It therefore does no database work. It used to re-read the User row here to refresh
    // token.roleKey / token.roleName, which cost one query per session read on top of
    // getAccess() — the same row, twice. Those two fields are now served from getAccess()
    // instead (see getCurrentUser in src/lib/auth-helpers.ts), which reads them fresh from
    // the database per request, so the copies in the token are display fallbacks and
    // nothing reads them for a decision.
    async jwt({ token, user }: { token: AppToken; user?: AppAuthUser }) {
      if (user) {
        token.userId = user.id;
        token.roleKey = (user as unknown as { roleKey: string }).roleKey;
        token.roleName = (user as unknown as { roleName: string }).roleName;
      }
      return token;
    },
    async session({ session, token }: { session: AppSession; token: AppToken }) {
      if (session.user) {
        const u = session.user as { userId?: string; roleKey?: string; roleName?: string };
        u.userId = token.userId as string;
        u.roleKey = token.roleKey as string;
        u.roleName = token.roleName as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

import { getServerSession } from "next-auth/next";

export type AuthUser = {
  id: string;
  userId?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  roleKey?: string;
  roleName?: string;
  role: string;
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const u = session.user as {
    userId?: string;
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    roleKey?: string;
    roleName?: string;
    role?: string;
  };
  const roleKey = u.roleKey || "";
  const role = u.role || (roleKey === "ADMIN" || roleKey === "STAFF_LMS_ADMIN" ? "admin" : "staff");
  return {
    id: u.userId || u.id || "",
    userId: u.userId || u.id || "",
    name: u.name,
    email: u.email,
    image: u.image,
    roleKey: u.roleKey,
    roleName: u.roleName,
    role,
  };
}
