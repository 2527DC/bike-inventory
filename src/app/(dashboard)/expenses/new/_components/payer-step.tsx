"use client";

// Step 3 — who paid (plan 1210-expense-store-department-and-payer, R3; decisions D6, E3).
// Shown to everyone who can create an expense: me (pre-selected), another staff member, or a
// typed name for someone not on staff — a Porter driver. This screen only collects the choice;
// the server resolves it to `paidById` + `paidBy` (src/lib/expenses/assignment.ts).
import { Check, User, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  nameKey,
  payerBody,
  type PayerDraft,
  type RecentPayer,
  type StaffOption,
} from "./types";

/** Recent names shown as chips. The route sends up to 50; a phone shows a handful. */
const RECENT_CHIPS = 8;

interface PayerStepProps {
  me: StaffOption;
  /** Active staff. */
  users: StaffOption[];
  recentPayers: RecentPayer[];
  value: PayerDraft;
  onChange: (value: PayerDraft) => void;
  onNext: () => void;
}

export function PayerStep({ me, users, recentPayers, value, onChange, onNext }: PayerStepProps) {
  const ready = payerBody(value) !== null;

  // "Me" is its own choice, so the staff list leaves the signed-in person out.
  const staffOptions = users.filter((u) => u.id !== me.id).map((u) => ({ id: u.id, label: u.name }));

  // A typed name that IS a staff member's name. Offered as a one-tap switch so their spends
  // land under their account in the report; never a block — two people can share a name.
  const typedKey = nameKey(value.name);
  const staffMatch =
    value.kind === "name" && typedKey.length >= 2
      ? users.find((u) => nameKey(u.name) === typedKey) ?? null
      : null;

  // Most used first (the route's order), narrowed by what is typed so far.
  const chips = recentPayers
    .filter((r) => {
      const key = nameKey(r.name);
      return key !== typedKey && (!typedKey || key.includes(typedKey));
    })
    .slice(0, RECENT_CHIPS);

  const choices: { kind: PayerDraft["kind"]; label: string; hint: string; icon: LucideIcon }[] = [
    { kind: "self", label: `Me — ${me.name}`, hint: "You paid it yourself", icon: User },
    { kind: "user", label: "Staff member", hint: "A colleague with an account here", icon: Users },
    { kind: "name", label: "Someone not on staff", hint: "A Porter driver, a helper", icon: UserPlus },
  ];

  function switchToStaff(match: StaffOption) {
    onChange(match.id === me.id ? { ...value, kind: "self" } : { ...value, kind: "user", userId: match.id });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onNext();
      }}
    >
      <p className="text-sm font-medium text-slate-700 mb-2">Who paid for this?</p>
      <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Who paid">
        {choices.map(({ kind, label, hint, icon: Icon }) => {
          const selected = value.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...value, kind })}
              className={`relative flex items-center gap-3 text-left rounded-xl border px-3 py-2.5 min-h-[56px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                selected
                  ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-blue-700" : "text-slate-500"}`} />
              <span className="min-w-0 flex-1 pr-6">
                <span className={`block text-sm font-semibold leading-tight truncate ${selected ? "text-blue-900" : "text-slate-900"}`}>
                  {label}
                </span>
                <span className="block text-[11px] text-slate-500 leading-tight mt-0.5">{hint}</span>
              </span>
              {selected && (
                <span className="absolute top-1/2 -translate-y-1/2 right-3 h-5 w-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {value.kind === "user" && (
        <div className="mt-4">
          <label htmlFor="expense-payer-staff" className="block text-sm font-medium text-slate-700 mb-1.5">
            Which staff member?
          </label>
          <SearchableSelect
            id="expense-payer-staff"
            options={staffOptions}
            value={value.userId}
            onChange={(userId) => onChange({ ...value, userId })}
            placeholder="Search staff by name"
            emptyText="No active staff member by that name"
          />
          {!value.userId && <p className="mt-1.5 text-xs text-slate-500">Pick the staff member to continue.</p>}
        </div>
      )}

      {value.kind === "name" && (
        <div className="mt-4">
          <label htmlFor="expense-payer-name" className="block text-sm font-medium text-slate-700 mb-1.5">
            Their name
          </label>
          <Input
            id="expense-payer-name"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            maxLength={80}
            placeholder="e.g. Porter driver's name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className="min-h-[44px] text-base"
          />
          {!ready && <p className="mt-1.5 text-xs text-slate-500">Type their name — at least 2 letters.</p>}

          {chips.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Used before</p>
              <div className="flex flex-wrap gap-2">
                {chips.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => onChange({ ...value, name: r.name })}
                    className="min-h-[44px] max-w-full px-3 rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                  >
                    <span className="block truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {staffMatch && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-900">
                {staffMatch.id === me.id ? (
                  <>That is your own name. Record it as paid by you?</>
                ) : (
                  <>
                    <span className="font-semibold">{staffMatch.name}</span> is on staff. Record it against
                    their account, so it shows under their name in reports?
                  </>
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => switchToStaff(staffMatch)}
                className="mt-2 min-h-[44px] w-full"
              >
                {staffMatch.id === me.id ? "Switch to Me" : `Switch to ${staffMatch.name}`}
              </Button>
              <p className="mt-1.5 text-[11px] text-blue-800">Or carry on — a different person can share the name.</p>
            </div>
          )}
        </div>
      )}

      <Button type="submit" size="lg" disabled={!ready} className="w-full min-h-[48px] mt-6">
        Next
      </Button>
    </form>
  );
}
