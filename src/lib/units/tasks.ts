import { createLogger } from "@/lib/logger";
import { OPEN_TASK_STATUSES, type Tx } from "./constants";

const log = createLogger("units:tasks");

/**
 * Close the open assembly tasks of units that just left the building or stopped existing
 * (sold, lost, reset, put on a van). A mechanic cannot build a cycle that is not there, and a
 * task left open would keep it on a build queue forever. Returns how many were cancelled.
 */
export async function cancelOpenTasks(tx: Tx, unitIds: string[], why: string): Promise<number> {
  if (unitIds.length === 0) return 0;
  const { count } = await tx.assemblyTask.updateMany({
    where: { unitId: { in: unitIds }, status: { in: OPEN_TASK_STATUSES } },
    data: { status: "CANCELLED" },
  });
  if (count > 0) log.info("open assembly tasks cancelled", { units: unitIds.length, tasks: count, why });
  return count;
}
