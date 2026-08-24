import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

export function successResponse(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Log a caught error on the SERVER, then return it to the client.
 *
 * Use this in every route `catch` instead of bare `errorResponse(e.message, 500)`.
 *
 * The pattern it replaces threw away everything that makes a 500 diagnosable. A real
 * incident on this app —
 *
 *     POST /api/zoho/trigger-pull 500
 *     "Unexpected token '<', "<html><hea"... is not valid JSON"
 *
 * — put the parser's complaint in front of the user and left NOTHING in the server log: no
 * stack, no failing URL, no step. The stack was the only thing that identified which of the
 * four `res.json()` calls in the request path had actually blown up.
 *
 *     } catch (error) {
 *       return failure(error, { scope: "zoho:pull", step, pullId });
 *     }
 */
export function failure(
  error: unknown,
  ctx: { scope: string; status?: number } & Record<string, unknown>
) {
  const { scope, status = 500, ...rest } = ctx;
  const err = error instanceof Error ? error : new Error(String(error));

  createLogger(scope).error(err.message, {
    name: err.name,
    // First frames only — enough to name the failing call, short enough to stay readable.
    stack: err.stack?.split("\n").slice(1, 6).join("\n"),
    ...rest,
  });

  return errorResponse(err.message, status);
}

export function paginatedResponse(
  data: unknown[],
  total: number,
  page: number,
  limit: number
) {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
}

export function parseSearchParams(url: string) {
  const { searchParams } = new URL(url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    500,
    Math.max(1, parseInt(searchParams.get("limit") || "50", 10))
  );
  const skip = (page - 1) * limit;

  const ALLOWED_SORT = ["createdAt", "updatedAt", "name", "sku", "currentStock", "costPrice", "sellingPrice", "dueDate", "billDate", "amount"];
  const rawSort = searchParams.get("sortBy") || "createdAt";
  const sortBy = ALLOWED_SORT.includes(rawSort) ? rawSort : "createdAt";
  const sortOrder = (searchParams.get("sortOrder") || "desc") === "asc" ? "asc" as const : "desc" as const;

  const search = searchParams.get("search") || undefined;

  return { page, limit, skip, sortBy, sortOrder, search, searchParams };
}
