# AI Analytics & API Spend Tracking — Implemented

Status: Completed (15 Sep 2026)

## Resolved Architecture Decisions

1. **Dashboard Location:**
   - **Implemented Location:** `src/app/(dashboard)/settings/ai/page.tsx` under the tab **"Usage & Spend Analytics"**.
   - **Rationale:** Gated under the existing `settings_ai` module permission. Admins configure providers, test models, and monitor spend directly in one place to make informed provider-switching decisions.

2. **Charting / Visualization:**
   - **Implemented Design:** Clean native Tailwind CSS metric cards, proportional feature spend progress bars, provider/model distribution cards, and filterable recent call logs table.
   - **Rationale:** Zero new bundle dependencies, instant load times, 100% SSR-safe in React 19 / Next.js 16, avoiding hydration and version mismatch issues.

3. **Database Schema & Cost Storage:**
   - **Implemented Model:** `AiCallLog` in `prisma/schema.prisma` (`ai_call_log` table).
   - **Pricing Engine:** `src/lib/ai/pricing.ts` with model rate catalogue in USD and INR conversion (₹85 / $1).
   - **Storage:** Exact `inputTokens`, `outputTokens`, `totalTokens`, `costUsd` (Decimal 10,6), and `costInr` (Decimal 10,4) are stored per request at write time.
   - **Rationale:**
     1. Prevents historical distortion: Rate changes will not rewrite historical billing.
     2. Database aggregations (`SUM`, `GROUP BY`) are fast and efficient via PostgreSQL indexes.
     3. Granular token transparency is fully preserved.

4. **Instrumentation & Observability:**
   - **Central Wrapper:** `src/lib/ai/index.ts` (`runAi`) logs every request across all features (`bank.statement_parse`, `po.sheet_columns`, `po.sheet_rows`, `payments.screenshot_scan`, `catalogue.pdf_extract`, etc.) asynchronously without blocking or slowing user requests.
   - **Analytics API:** `src/app/api/settings/ai/analytics/route.ts` provides aggregated KPIs, feature spend breakdowns, model distributions, and recent audit logs for time ranges (`today`, `7d`, `30d`, `this_month`, `all`).
