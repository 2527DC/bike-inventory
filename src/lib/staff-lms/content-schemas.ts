// ─── Shapes of the LMS Json columns ──────────────────────────────────────────
// Twelve columns across the LMS tables are `Json`, so Prisma types them as
// `Prisma.JsonValue` — a union that is assignable to nothing useful. The source app dealt
// with that by scattering ~40 `as any` casts across ~15 route files, backed by 247 lines
// of hand-maintained parallel interfaces in src/types/index.ts that nothing enforced.
//
// Here each shape is declared ONCE, as a Zod schema, and the TypeScript type is derived
// with z.infer. There is no second list of interfaces to drift.
//
// Every schema is used two ways:
//   - on WRITE, by the request validators in src/lib/validations.ts, so bad content is
//     rejected at the boundary with a 400;
//   - on READ, by src/lib/staff-lms/serialize.ts, which parses with `.catch(...)` so a
//     legacy row that predates a shape yields a safe empty value instead of crashing a
//     React component halfway down a product page.
//
// That second point is why the schemas are permissive about optional fields. A row seeded
// eighteen months ago is not a bug to be surfaced at render time.

import { z } from "zod";

/** One objection a customer raises, and the answer that works. */
export const lmsObjectionSchema = z.object({
  objection: z.string(),
  response: z.string(),
});
export type LmsObjection = z.infer<typeof lmsObjectionSchema>;

/**
 * Why this customer actually buys. The narrative core of a product playbook — eight fields
 * of sales psychology, all optional because they were filled in over time per product.
 */
export const lmsBuyerPsychologySchema = z.object({
  emotionalTriggers: z.array(z.string()).default([]),
  socialNeeds: z.array(z.string()).default([]),
  psychologicalDrivers: z.array(z.string()).default([]),
  fearAndAnxiety: z.array(z.string()).default([]),
  dreamOutcome: z.string().default(""),
  buyerPersona: z.string().default(""),
  decisionStyle: z.string().default(""),
  hiddenMotivation: z.string().default(""),
});
export type LmsBuyerPsychology = z.infer<typeof lmsBuyerPsychologySchema>;

/**
 * A competing bicycle. These deliberately name bikes BCH does NOT stock — the point is to
 * answer "why not that one", so this can never be a link to the inventory Product table.
 */
export const lmsCompetitorSchema = z.object({
  name: z.string(),
  brand: z.string().default(""),
  price: z.number().nullable().default(null),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  verdict: z.string().default(""),
});
export type LmsCompetitor = z.infer<typeof lmsCompetitorSchema>;

/** A single review quote, best or worst. */
export const lmsReviewSchema = z.object({
  summary: z.string(),
  rating: z.number().min(0).max(5).nullable().default(null),
  source: z.string().optional(),
});
export type LmsReview = z.infer<typeof lmsReviewSchema>;

/** Reviews split into what people praise and what they complain about. */
export const lmsReviewsSchema = z.object({
  best: z.array(lmsReviewSchema).default([]),
  worst: z.array(lmsReviewSchema).default([]),
});
export type LmsReviews = z.infer<typeof lmsReviewsSchema>;

/** Where a claim on the playbook came from, so a seller can check it. */
export const lmsSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});
export type LmsSource = z.infer<typeof lmsSourceSchema>;

/** A question customers ask on the shop floor, with the answer. */
export const lmsFaqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type LmsFaq = z.infer<typeof lmsFaqSchema>;

/**
 * Free-form spec sheet: "Motor" -> "250W BLDC hub". A record, not a fixed shape, because
 * an e-cycle and a kids bike do not have the same rows and never will.
 */
export const lmsSpecsSchema = z.record(z.string(), z.string());
export type LmsSpecs = z.infer<typeof lmsSpecsSchema>;

/** One step in a playbook or lesson checklist. */
export const lmsChecklistItemSchema = z.object({
  step: z.string(),
  done: z.boolean().default(false),
});
export type LmsChecklistItem = z.infer<typeof lmsChecklistItemSchema>;

/** The key points a lesson wants remembered — plain strings shown as bullets. */
export const lmsKeyPointersSchema = z.array(z.string());

/**
 * Multiple-choice options. Stored as Json rather than String[] in the source app; kept
 * that way so the seeded content ports without transformation.
 */
export const lmsOptionsSchema = z.array(z.string());

/**
 * A learner's submitted answers: the chosen option index per question, in order.
 *
 * `nullable` because a skipped question is a real answer — the source app wrote `null` for
 * unanswered, and grading counts it as wrong rather than throwing.
 */
export const lmsAnswersSchema = z.array(z.number().int().nullable());

/** Which checklist steps a learner has ticked, by index. */
export const lmsChecklistDoneSchema = z.array(z.number().int());

/** Arbitrary context attached to an activity-log row. Never rendered as structured data. */
export const lmsActivityDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);
export type LmsActivityDetails = z.infer<typeof lmsActivityDetailsSchema>;
