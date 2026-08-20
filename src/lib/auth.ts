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

type AppSession = {
  user?: { name?: string | null; email?: string | null; [k: string]: unknown } | null;
  [k: string]: unknown;
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
    async jwt({ token, user }: { token: AppToken; user?: AppAuthUser }) {
      if (user) {
        token.userId = user.id;
        token.roleKey = (user as unknown as { roleKey: string }).roleKey;
        token.roleName = (user as unknown as { roleName: string }).roleName;
      } else if (token.userId) {
        // Refresh the role label live so a reassigned user sees the change without
        // logging out. This is DISPLAY ONLY — authorisation never reads the token, it
        // resolves permissions from the DB per request (src/lib/rbac.ts).
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.userId as string },
            select: { role: { select: { key: true, name: true } } },
          });
          if (dbUser?.role) {
            token.roleKey = dbUser.role.key;
            token.roleName = dbUser.role.name;
          }
        } catch {
          /* keep the existing token values on a transient DB error */
        }
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
