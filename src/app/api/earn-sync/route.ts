import { NextRequest, NextResponse } from "next/server";

const SYNC_KEY = process.env.EARN_SYNC_KEY || "";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!SYNC_KEY || key !== SYNC_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateStr = req.nextUrl.searchParams.get("date");
  const date = dateStr ? new Date(dateStr) : new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const todayStr = dayStart.toISOString().slice(0, 10);

  return NextResponse.json({
    source: "bike-inventory",
    date: todayStr,
    note: "Tasks, SOPs, and checklists have been moved out of this app. Connect to the new ops hub for compliance data.",
    events: [],
  });
}
