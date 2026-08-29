// ─── Reading the LMS Json columns safely ─────────────────────────────────────
// THE ONLY PLACE in the LMS code that narrows `Prisma.JsonValue`. Every route that returns
// a row with Json columns runs it through here first; nothing else casts.
//
// Why it exists
// -------------
// Prisma types a Json column as `Prisma.JsonValue`, which is assignable to nothing useful.
// The source app answered that with ~40 `as any` casts spread over ~15 files. An `as any`
// is not a check — it is a promise, and a row seeded eighteen months ago against an older
// shape breaks that promise at RENDER time, inside a React component, as a white screen.
//
// The contract here is the opposite: `.catch(fallback)` means a malformed column yields an
// empty array / empty object and the page renders with a section missing, which a seller
// can work around and an editor can see and fix. Content that is merely OLD must never take
// a learning screen down mid-shift.
//
// A parse failure is logged at `warn` with the row id, so "this product's competitors are
// blank" is diagnosable without reproducing it.

import type { LmsProduct, LmsScenario, LmsLesson } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import {
  lmsBuyerPsychologySchema,
  lmsChecklistItemSchema,
  lmsCompetitorSchema,
  lmsFaqSchema,
  lmsKeyPointersSchema,
  lmsObjectionSchema,
  lmsOptionsSchema,
  lmsReviewsSchema,
  lmsSourceSchema,
  lmsSpecsSchema,
  type LmsBuyerPsychology,
  type LmsChecklistItem,
  type LmsCompetitor,
  type LmsFaq,
  type LmsObjection,
  type LmsReviews,
  type LmsSource,
  type LmsSpecs,
} from "@/lib/staff-lms/content-schemas";

const log = createLogger("staff-lms:serialize");

/**
 * Parse one Json column, falling back rather than throwing.
 *
 * `where` is a human label such as `lms_products.competitors#clx123` — enough to find the
 * row again. This is the identifier-not-payload rule: we log which row is wrong, never
 * what was in it.
 */
function parseJson<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  value: unknown,
  fallback: T,
  where: string
): T {
  const result = schema.safeParse(value);
  if (result.success && result.data !== undefined) return result.data;
  // Absent is normal — a column that was never filled in is not a fault worth a log line.
  if (value === null || value === undefined) return fallback;
  log.warn("malformed json column, using fallback", { where });
  return fallback;
}

// ── Products ────────────────────────────────────────────────────────────────

/** An LmsProduct with its eight Json columns narrowed to real types. */
export type SerializedLmsProduct = Omit<
  LmsProduct,
  "commonObjections" | "buyerPsychology" | "specs" | "competitors" | "reviews" | "sources" | "faqs"
> & {
  commonObjections: LmsObjection[];
  buyerPsychology: LmsBuyerPsychology | null;
  specs: LmsSpecs;
  competitors: LmsCompetitor[];
  reviews: LmsReviews;
  sources: LmsSource[];
  faqs: LmsFaq[];
};

export function serializeLmsProduct(p: LmsProduct): SerializedLmsProduct {
  const at = (col: string) => `lms_products.${col}#${p.id}`;
  return {
    ...p,
    commonObjections: parseJson(
      lmsObjectionSchema.array(),
      p.commonObjections,
      [],
      at("common_objections")
    ),
    // Null rather than an empty object: the UI hides the whole psychology tab when a
    // product has none, and an all-blank tab is worse than an absent one.
    buyerPsychology: parseJson<LmsBuyerPsychology | null>(
      lmsBuyerPsychologySchema.nullable(),
      p.buyerPsychology,
      null,
      at("buyer_psychology")
    ),
    specs: parseJson(lmsSpecsSchema, p.specs, {}, at("specs")),
    competitors: parseJson(lmsCompetitorSchema.array(), p.competitors, [], at("competitors")),
    reviews: parseJson(lmsReviewsSchema, p.reviews, { best: [], worst: [] }, at("reviews")),
    sources: parseJson(lmsSourceSchema.array(), p.sources, [], at("sources")),
    faqs: parseJson(lmsFaqSchema.array(), p.faqs, [], at("faqs")),
  };
}

// ── Playbooks (scenarios) ───────────────────────────────────────────────────

export type SerializedLmsScenario = Omit<LmsScenario, "checklist"> & {
  checklist: LmsChecklistItem[];
};

export function serializeLmsScenario(s: LmsScenario): SerializedLmsScenario {
  return {
    ...s,
    checklist: parseJson(
      lmsChecklistItemSchema.array(),
      s.checklist,
      [],
      `lms_scenarios.checklist#${s.id}`
    ),
  };
}

// ── Lessons ─────────────────────────────────────────────────────────────────

export type SerializedLmsLesson = Omit<LmsLesson, "keyPointers" | "checklist"> & {
  keyPointers: string[];
  checklist: LmsChecklistItem[];
};

export function serializeLmsLesson(l: LmsLesson): SerializedLmsLesson {
  const at = (col: string) => `lms_lessons.${col}#${l.id}`;
  return {
    ...l,
    keyPointers: parseJson(lmsKeyPointersSchema, l.keyPointers, [], at("key_pointers")),
    checklist: parseJson(lmsChecklistItemSchema.array(), l.checklist, [], at("checklist")),
  };
}

// ── Questions ───────────────────────────────────────────────────────────────

/**
 * A quiz / lesson / weekly-test question AS SENT TO A LEARNER.
 *
 * `correctIndex` is absent from this type BY CONSTRUCTION, not by convention. The source
 * app returned it to every learner on every question, which made every quiz beatable from
 * devtools in about four seconds. Grading is server-side, so the client never needs it.
 *
 * The `edit`-gated content endpoints return the raw row instead — that is the only place
 * the key is allowed to leave the server.
 */
export interface LearnerQuestion {
  id: string;
  question: string;
  options: string[];
  sortOrder: number;
}

type RawQuestion = {
  id: string;
  question: string;
  options: unknown;
  sortOrder: number;
  correctIndex?: number;
  explanation?: string | null;
};

/**
 * Strip the answer key and narrow `options`.
 *
 * Deliberately builds a NEW object field by field rather than spreading and deleting.
 * A spread-then-delete leaks the moment someone adds a column, and it is the sort of thing
 * that reads as correct in review.
 */
export function toLearnerQuestion(q: RawQuestion, table: string): LearnerQuestion {
  return {
    id: q.id,
    question: q.question,
    options: parseJson(lmsOptionsSchema, q.options, [], `${table}.options#${q.id}`),
    sortOrder: q.sortOrder,
  };
}

export function toLearnerQuestions(qs: RawQuestion[], table: string): LearnerQuestion[] {
  return qs.map((q) => toLearnerQuestion(q, table));
}
