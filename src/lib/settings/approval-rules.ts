import { z } from "zod";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:approval-rules");

/**
 * What counts as an approver error (plan 1709-priority-build-and-stock-flow, R26, Q18).
 *
 * An approver error is an `ApprovalEvent` that judges an earlier APPROVED inbound or transfer:
 * a correction within `windowDays`, a short receive, or a reversal. Customer flags are recorded
 * but not counted unless `countFlag` is on. The rule and N are settings, stored as JSON in
 * AppSetting — no migration to change them. Pattern copied from `bin-tracking.ts` (removed in plan 2109, Q27).
 */
export const APPROVAL_RULES_SETTING_KEY = "approver_error_rule";

export const approvalRulesSchema = z.object({
  countCorrection: z.boolean(),
  countShortReceive: z.boolean(),
  countReversal: z.boolean(),
  countFlag: z.boolean(),
  windowDays: z.number().int().min(1).max(365),
});

export type ApprovalRules = z.infer<typeof approvalRulesSchema>;

export const DEFAULT_APPROVAL_RULES: ApprovalRules = {
  countCorrection: true,
  countShortReceive: true,
  countReversal: true,
  countFlag: false,
  windowDays: 7,
};

// Short TTL so a route reading this on every request does not query the database each time.
let cachedValue: ApprovalRules | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5000;

/**
 * Parse a stored value. A missing key falls back to its default individually, so a row saved
 * before a field existed still reads; anything unparseable falls back to the defaults entirely.
 */
function parseStored(raw: string): ApprovalRules {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    log.warn("stored approval rules are not valid JSON, using defaults", {
      key: APPROVAL_RULES_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_APPROVAL_RULES;
  }
  const parsed = approvalRulesSchema.partial().safeParse(json);
  if (!parsed.success) {
    log.warn("stored approval rules failed validation, using defaults", {
      key: APPROVAL_RULES_SETTING_KEY,
      issues: parsed.error.issues.length,
    });
    return DEFAULT_APPROVAL_RULES;
  }
  const d = DEFAULT_APPROVAL_RULES;
  return {
    countCorrection: parsed.data.countCorrection ?? d.countCorrection,
    countShortReceive: parsed.data.countShortReceive ?? d.countShortReceive,
    countReversal: parsed.data.countReversal ?? d.countReversal,
    countFlag: parsed.data.countFlag ?? d.countFlag,
    windowDays: parsed.data.windowDays ?? d.windowDays,
  };
}

/** The current approver-error rule. Never throws: a read failure returns the defaults. */
export async function getApprovalRules(): Promise<ApprovalRules> {
  const now = Date.now();
  if (cachedValue !== null && now < cacheExpiry) return cachedValue;

  let value = DEFAULT_APPROVAL_RULES;
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: APPROVAL_RULES_SETTING_KEY },
    });
    if (setting) value = parseStored(setting.value);
  } catch (err) {
    log.warn("could not read approval rules from db, using defaults", {
      key: APPROVAL_RULES_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    // Not cached: the next request retries the database.
    return value;
  }

  cachedValue = value;
  cacheExpiry = now + CACHE_TTL_MS;
  return value;
}

/**
 * Save the rule. `input` is validated here as well as at the route, so no caller can store a
 * value the reader would reject. Throws (after logging) if validation or the write fails.
 */
export async function setApprovalRules(input: unknown): Promise<ApprovalRules> {
  const parsed = approvalRulesSchema.safeParse(input);
  if (!parsed.success) {
    log.warn("approval rules rejected by validation", {
      key: APPROVAL_RULES_SETTING_KEY,
      issues: parsed.error.issues.length,
    });
    throw parsed.error;
  }
  const value = parsed.data;
  const raw = JSON.stringify(value);

  try {
    await prisma.appSetting.upsert({
      where: { key: APPROVAL_RULES_SETTING_KEY },
      create: { key: APPROVAL_RULES_SETTING_KEY, value: raw },
      update: { value: raw },
    });
  } catch (err) {
    log.error("approval rules write failed", {
      key: APPROVAL_RULES_SETTING_KEY,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  cachedValue = value;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  log.info("approval rules updated", { key: APPROVAL_RULES_SETTING_KEY, ...value });
  return value;
}
