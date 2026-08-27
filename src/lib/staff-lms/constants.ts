// ─── Staff LMS constants ─────────────────────────────────────────────────────
// Values that are fixed by the domain rather than configurable. Anything an admin should
// be able to change belongs in a table, not here.
//
// This file replaces the source app's `app_settings` table, which held exactly two keys
// (`brands`, `categories`) read by one screen to fill two dropdowns — and was broken:
// GET /api/settings ignored `?key=` and never returned `value`, while the page read
// `data.value`. The table, the route and the screen are all deleted rather than ported.

/**
 * Riding styles — the LMS product taxonomy.
 *
 * NOT the inventory `Category` table, which is a product CLASS (Bicycles, Spare Parts,
 * Accessories, Tyres & Tubes). These are riding styles. Orthogonal taxonomies: a Kids
 * e-cycle is `Kids` here and `Bicycles` there, and neither answers the other's question.
 * That is why LmsProduct.category is a plain string with no FK.
 *
 * Frozen because riding styles do not change. If they ever do, this is a one-line edit
 * and a redeploy — which is the correct cost for something that changes once a decade.
 */
export const LMS_RIDING_STYLES = [
  "MTB",
  "Hybrid",
  "Road",
  "Kids",
  "City",
  "E-Cycle",
] as const;

export type LmsRidingStyle = (typeof LMS_RIDING_STYLES)[number];

/**
 * Brand options offered by the content editor.
 *
 * Deliberately NOT read from the inventory `Brand` table. Verified against production
 * (24 Aug 2026): that table holds 60+ rows, ALL UPPERCASE, including `FARHAN TEXTILES`,
 * `SANGAM HARDWARE`, `ACCESSORIES`, `BEPOSITIVE RACING PRIVATE LIMITE`, and BOTH `RALEIGH`
 * and `RALIEGH` as separate rows. It is a purchasing master, not a list of bicycle brands a
 * salesperson learns playbooks for — putting it in this dropdown would be actively wrong.
 *
 * These are a convenience list, not a constraint: the editor accepts free text, so a new
 * brand needs no code change. Sorted for the dropdown.
 */
export const LMS_BRANDS = [
  "EMotorad",
  "Raleigh",
  "Hero",
  "Hercules",
  "Montra",
  "Ninety One",
  "Stryder",
  "Suncross",
] as const;

/** Difficulty levels shared by playbooks, quizzes and lessons. */
export const LMS_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type LmsDifficulty = (typeof LMS_DIFFICULTIES)[number];

/** Playbook (scenario) kinds. */
export const LMS_SCENARIO_TYPES = [
  "walk-in",
  "phone",
  "repeat",
  "festival",
  "parent",
  "comparison",
  "service-upsell",
] as const;

/** Quiz kinds. */
export const LMS_QUIZ_TYPES = ["product", "scenario", "general", "objection-handling"] as const;

/**
 * Every activity type written to `lms_activity_log`.
 *
 * `roleplay_completed` is absent: AI roleplay is out of scope, so nothing can ever write
 * it. See LMS_ACHIEVEMENT_CRITERIA below for the matching gap on the achievement side.
 */
export const LMS_ACTIVITY_TYPES = [
  "login",
  "lesson_completed",
  "quiz_completed",
  "weekly_test_completed",
  "product_learned",
  "video_watched",
  "playbook_completed",
  "achievement_earned",
] as const;

export type LmsActivityType = (typeof LMS_ACTIVITY_TYPES)[number];

/**
 * Achievement criteria the award engine can actually evaluate.
 *
 * The source app also had `roleplay_count`. It is omitted on purpose — with roleplay out
 * of scope, such a row could never be satisfied, so it would sit in the achievements list
 * as a permanently unreachable badge. `checkAchievements` warns on any criteria type not
 * in this list rather than silently treating it as unmet.
 */
export const LMS_ACHIEVEMENT_CRITERIA = [
  "quizzes_passed",
  "streak_days",
  "xp_total",
  "videos_watched",
  "lessons_completed",
  "products_learned",
] as const;

export type LmsAchievementCriteria = (typeof LMS_ACHIEVEMENT_CRITERIA)[number];

/**
 * XP awarded per action. Central so the numbers can be compared at a glance — they were
 * scattered across six route handlers in the source app, and had already drifted.
 */
export const LMS_XP = {
  /** First visit of the day. Awarded by the heartbeat, once per user per day. */
  dailyLogin: 15,
  lessonCompleted: 30,
  quizPassed: 50,
  weeklyTestPassed: 100,
  productLearned: 20,
  videoWatched: 10,
  playbookCompleted: 25,
} as const;

/** Level thresholds. Index i is the XP needed to reach level i+1. */
export const LMS_LEVEL_THRESHOLDS = [
  0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500,
] as const;

export const LMS_LEVEL_TITLES = [
  "Rookie",
  "Learner",
  "Apprentice",
  "Seller",
  "Skilled Seller",
  "Senior Seller",
  "Expert",
  "Master",
  "Sales Leader",
  "Sales Champion",
  "BCH Legend",
] as const;
