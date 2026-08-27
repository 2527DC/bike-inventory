// ─── Route wrapper for /api/staff-lms/* ──────────────────────────────────────
// SERVER ONLY.
//
// Thirty-odd LMS route handlers share the same five lines of ceremony: guard, parse,
// do the work, map errors, log. Written out per handler that is ~450 lines of duplicated
// catch blocks, and duplicated catch blocks drift — one of them ends up swallowing a
// ZodError as a 500, or logging nothing, and nobody notices until an incident.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It does not hide the guard. `guarded("staff_lms_learning", "edit", …)` names its module
// and action as literal arguments at every call site, exactly as `requireFeature` does, so
//
//     grep -rn "guarded(" src/app/api/staff-lms
//
// lists every route's authorisation in one screen. A factory that inferred the module from
// the folder, or defaulted the action from the HTTP verb, would remove the one thing a
// reviewer most needs to see — and CLAUDE.md is explicit that access must be legible.
//
// There is no role list, no admin short-circuit and no third argument that could become
// one. It calls `requireFeature` and nothing else.

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError, type CurrentUser, type PermAction } from "@/lib/auth-helpers";

export interface LmsRouteContext {
  req: NextRequest;
  /** The authenticated user. THE ONLY source of userId for a learner write. */
  user: CurrentUser;
  /** Route params, already awaited. Empty for non-dynamic routes. */
  params: Record<string, string>;
}

type Handler = (ctx: LmsRouteContext) => Promise<NextResponse>;

/** Next 16 hands dynamic route params in as a promise. */
type RouteArgs = { params?: Promise<Record<string, string>> };

/**
 * Wrap one HTTP method with its permission check and a single error contract.
 *
 *     export const POST = guarded("staff_lms_products", "create", "staff-lms:products",
 *       async ({ req, user }) => { … });
 *
 * Error mapping, in order:
 *   AuthError -> its own status (401 unauthenticated, 403 unauthorised)
 *   ZodError  -> 400 with the failing FIELD NAMES, not Zod's raw dump. A validation
 *                failure is the client's bug to fix, and "answers.2: expected number"
 *                tells them where; the default message is a JSON blob nobody reads.
 *   anything else -> 500 via failure(), which logs the stack server-side first. A bare
 *                errorResponse(e.message, 500) throws away the only thing that makes a
 *                500 diagnosable.
 */
export function guarded(
  moduleKey: string,
  action: PermAction,
  scope: string,
  handler: Handler
) {
  return async (req: NextRequest, args?: RouteArgs): Promise<NextResponse> => {
    try {
      const user = await requireFeature(moduleKey, action);
      const params = args?.params ? await args.params : {};
      return await handler({ req, user, params });
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.message, error.status);

      if (error instanceof ZodError) {
        const detail = error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; ");
        return errorResponse(detail, 400);
      }

      return failure(error, { scope, module: moduleKey, action });
    }
  };
}

/**
 * Read and parse a JSON body.
 *
 * Handles the empty-body case explicitly: `req.json()` throws a SyntaxError on an empty
 * request, which would otherwise surface as a 500 with "Unexpected end of JSON input" —
 * a message that blames the server for a client sending nothing.
 */
export async function readBody(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError("Request body is not valid JSON", 400);
  }
}

/**
 * Require a route param that must be present.
 *
 * A missing param means the file is in the wrong folder — a developer error, not a user
 * one — so it fails loudly rather than querying `where: { id: undefined }`, which Prisma
 * happily runs and which returns the WRONG ROW rather than none.
 */
export function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) throw new AuthError(`Missing route parameter: ${name}`, 400);
  return value;
}
