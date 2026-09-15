export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:ai:analytics");

const PURPOSE_LABELS: Record<string, string> = {
  "bank.statement_parse": "Bank Statement Parsing",
  "bank.vendor_resolve": "Vendor & Expense Resolution",
  "payments.screenshot_scan": "Payment Screenshot OCR",
  "catalogue.pdf_extract": "Brand Catalogue Extraction",
  "po.sheet_columns": "PO Sheet Column Mapping",
  "po.sheet_rows": "PO Sheet Line Extraction",
  "settings.self_test": "Provider Self-Test",
};

export async function GET(req: NextRequest) {
  try {
    await requireFeature("settings_ai", "view");

    const searchParams = req.nextUrl.searchParams;
    const range = searchParams.get("range") || "30d";
    const provider = searchParams.get("provider") || undefined;
    const purpose = searchParams.get("purpose") || undefined;

    const now = new Date();
    let since: Date | undefined;

    if (range === "today") {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (range === "7d") {
      since = new Date(now.getTime() - 7 * 86_400_000);
    } else if (range === "30d") {
      since = new Date(now.getTime() - 30 * 86_400_000);
    } else if (range === "this_month") {
      since = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (range === "all") {
      since = undefined;
    } else {
      since = new Date(now.getTime() - 30 * 86_400_000);
    }

    const where = {
      createdAt: since ? { gte: since } : undefined,
      providerKey: provider ? provider : undefined,
      purpose: purpose ? purpose : undefined,
    };

    const logs = await prisma.aiCallLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    let totalCalls = logs.length;
    let successfulCalls = 0;
    let failedCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let totalCostInr = 0;
    let sumLatencyMs = 0;

    const purposeMap: Record<
      string,
      { purpose: string; label: string; calls: number; tokens: number; costUsd: number; costInr: number }
    > = {};

    const providerMap: Record<
      string,
      { providerKey: string; model: string; calls: number; tokens: number; costUsd: number; costInr: number }
    > = {};

    const dailyMap: Record<
      string,
      { date: string; calls: number; tokens: number; costUsd: number; costInr: number }
    > = {};

    for (const item of logs) {
      if (item.ok) {
        successfulCalls++;
      } else {
        failedCalls++;
      }

      promptTokens += item.inputTokens;
      completionTokens += item.outputTokens;
      totalTokens += item.totalTokens;

      const usd = Number(item.costUsd);
      const inr = Number(item.costInr);

      totalCostUsd += usd;
      totalCostInr += inr;
      sumLatencyMs += item.latencyMs;

      // By Purpose
      if (!purposeMap[item.purpose]) {
        purposeMap[item.purpose] = {
          purpose: item.purpose,
          label: PURPOSE_LABELS[item.purpose] || item.purpose,
          calls: 0,
          tokens: 0,
          costUsd: 0,
          costInr: 0,
        };
      }
      purposeMap[item.purpose].calls++;
      purposeMap[item.purpose].tokens += item.totalTokens;
      purposeMap[item.purpose].costUsd += usd;
      purposeMap[item.purpose].costInr += inr;

      // By Provider & Model
      const provKey = `${item.providerKey}:${item.model}`;
      if (!providerMap[provKey]) {
        providerMap[provKey] = {
          providerKey: item.providerKey,
          model: item.model,
          calls: 0,
          tokens: 0,
          costUsd: 0,
          costInr: 0,
        };
      }
      providerMap[provKey].calls++;
      providerMap[provKey].tokens += item.totalTokens;
      providerMap[provKey].costUsd += usd;
      providerMap[provKey].costInr += inr;

      // Daily Time Series (YYYY-MM-DD)
      const day = item.createdAt.toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, calls: 0, tokens: 0, costUsd: 0, costInr: 0 };
      }
      dailyMap[day].calls++;
      dailyMap[day].tokens += item.totalTokens;
      dailyMap[day].costUsd += usd;
      dailyMap[day].costInr += inr;
    }

    const summary = {
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate: totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 100,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostUsd: Math.round(totalCostUsd * 10_000) / 10_000,
      totalCostInr: Math.round(totalCostInr * 100) / 100,
      avgLatencyMs: totalCalls > 0 ? Math.round(sumLatencyMs / totalCalls) : 0,
    };

    const byPurpose = Object.values(purposeMap).map((p) => ({
      ...p,
      costUsd: Math.round(p.costUsd * 10_000) / 10_000,
      costInr: Math.round(p.costInr * 100) / 100,
    })).sort((a, b) => b.costUsd - a.costUsd);

    const byProvider = Object.values(providerMap).map((p) => ({
      ...p,
      costUsd: Math.round(p.costUsd * 10_000) / 10_000,
      costInr: Math.round(p.costInr * 100) / 100,
    })).sort((a, b) => b.costUsd - a.costUsd);

    const daily = Object.values(dailyMap).map((d) => ({
      ...d,
      costUsd: Math.round(d.costUsd * 10_000) / 10_000,
      costInr: Math.round(d.costInr * 100) / 100,
    })).sort((a, b) => a.date.localeCompare(b.date));

    const recentLogs = logs.slice(0, 50).map((log) => ({
      id: log.id,
      purpose: log.purpose,
      label: PURPOSE_LABELS[log.purpose] || log.purpose,
      providerKey: log.providerKey,
      model: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      totalTokens: log.totalTokens,
      costUsd: Number(log.costUsd),
      costInr: Number(log.costInr),
      latencyMs: log.latencyMs,
      ok: log.ok,
      errorKind: log.errorKind,
      createdAt: log.createdAt.toISOString(),
    }));

    return successResponse({
      summary,
      byPurpose,
      byProvider,
      daily,
      recentLogs,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("failed to get ai analytics", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Failed to load AI analytics", 500);
  }
}
