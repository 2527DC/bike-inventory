"use client";

// "What the AI understood" (plan 1310 Part C): its own sentence about the input, then what the
// screen can say for certain — the period read, how many rows, and whether a model typed the
// amounts (text, image, PDF, or a sheet it could not map) rather than code reading them.
import type { LedgerProposals } from "@/lib/brand-ledger/ai-run";
import { plural } from "./review-types";

function day(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function Understood({ proposals }: { proposals: LedgerProposals }) {
  if (proposals.kind === "not_ledger") {
    return (
      <div className="card">
        <h3>Not for the ledger</h3>
        <div className="rv-explain">{proposals.explanation || "The AI read this as something other than a ledger or a claim."}</div>
        <p className="rv-muted" style={{ marginTop: 8 }}>
          Nothing can be added from this. Re-run it with a prompt that says what it is, or discard it.
        </p>
      </div>
    );
  }

  const facts: string[] = [];
  if (proposals.kind === "statement") {
    facts.push(plural(proposals.rows.length, "row") + " proposed");
    if (proposals.periodFrom || proposals.periodTo) facts.push(`${day(proposals.periodFrom)} – ${day(proposals.periodTo)}`);
    if (proposals.source === "plan") facts.push("amounts read from the sheet's cells");
    if (proposals.source === "sheet") facts.push("read by the fixed sheet reader, no AI");
  } else {
    facts.push(plural(proposals.claims.length, "claim") + " found");
  }

  const noAi = proposals.kind === "statement" && proposals.source === "sheet";
  return (
    <div className="card">
      <h3>{noAi ? "What was read" : "What the AI understood"}</h3>
      {proposals.explanation ? (
        <div className="rv-explain">{proposals.explanation}</div>
      ) : (
        !noAi && <p className="rv-muted">The AI gave no explanation for this run.</p>
      )}
      <p className="rv-muted" style={{ marginTop: 8 }}>{facts.join(" · ")}</p>
      {proposals.kind === "statement" && proposals.aiTyped && (
        <div className="rv-warn">The AI typed these amounts from a document or text — check each one against the original.</div>
      )}
    </div>
  );
}
