// Who may run and accept a prompted import (plan 1310). The permission follows what the run
// would WRITE if accepted — ledger rows need brand_ledger.create, claims need
// brand_ledger_gaps.create — the rule the older run and accept routes already use per task.
// Before the AI has decided, holding either one is enough to start; accept re-checks the real one.
import type { LedgerAiTask } from "@prisma/client";
import { requireAuth, AuthError, type CurrentUser } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import type { LedgerProposals } from "./ai-run";

export type LedgerWriteModule = "brand_ledger" | "brand_ledger_gaps";

/** Start or re-run a prompted import: either create permission will do. */
export async function requireImportAccess(): Promise<CurrentUser> {
  const user = await requireAuth();
  const [ledger, gaps] = await Promise.all([
    userCan(user.id, "brand_ledger", "create"),
    userCan(user.id, "brand_ledger_gaps", "create"),
  ]);
  if (!ledger && !gaps) {
    throw new AuthError("Importing to a ledger needs Create on Brand Ledgers or on Ledger Claims", 403);
  }
  return user;
}

/** The module whose create permission accepting (or discarding) this run needs. */
export function moduleForRun(task: LedgerAiTask, proposals: unknown): LedgerWriteModule {
  if (task === "STATEMENT_ROWS") return "brand_ledger";
  if (task === "PROMPTED_IMPORT") {
    const kind = (proposals as LedgerProposals | null)?.kind;
    return kind === "claims" ? "brand_ledger_gaps" : "brand_ledger";
  }
  return "brand_ledger_gaps";
}
