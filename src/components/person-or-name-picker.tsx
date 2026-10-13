"use client";

// "A staff user, or a typed name for someone outside the app" (plan 1210-bank-accounts-and-suspense,
// D4; decisions D6 and D19). The suspense register uses it for who chases a bank line — the
// external accountant Deekshith has no login — and plan A's expense payer has the same shape, so
// this is the one picker both use.
//
// It fetches nothing: the caller passes the user list (the suspense screens read
// GET /api/bank-suspense/assignees, because /api/users needs team.view) and owns its loading and
// error state, the SearchableSelect convention.
//
// Value contract:
//   { assigneeId: "<user id>", assigneeName: null }  a staff member
//   { assigneeId: null, assigneeName: "<typed>" }    someone outside the team (raw text — the API
//                                                    trims; at most 80 characters)
//   { assigneeId: null, assigneeName: null }         nobody yet, or "outside" chosen with no name
//                                                    typed so far — never an empty string
import { useId, useState } from "react";
import { Check, Search, UserRound, UserPlus, X } from "lucide-react";
import { cn, fuzzyMatch } from "@/lib/utils";

export interface PersonOrName {
  assigneeId: string | null;
  assigneeName: string | null;
}

interface PersonOrNamePickerProps {
  users: { id: string; name: string }[];
  value: PersonOrName;
  onChange: (v: PersonOrName) => void;
  disabled?: boolean;
}

const OUTSIDE_MAX = 80;
const NOBODY: PersonOrName = { assigneeId: null, assigneeName: null };

/** Substring first, fuzzy only when nothing matched literally (the SearchableSelect rule). */
function filterUsers(users: { id: string; name: string }[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  const literal = users.filter((u) => u.name.toLowerCase().includes(q));
  return literal.length > 0 ? literal : users.filter((u) => fuzzyMatch(query, u.name));
}

export function PersonOrNamePicker({ users, value, onChange, disabled = false }: PersonOrNamePickerProps) {
  const [query, setQuery] = useState("");
  // Set only by the person's own taps. Whether the text field shows is derived from it AND the
  // value, so a parent that pre-fills a typed name (or a user) is shown correctly without an
  // effect syncing state from props.
  const [outsideChosen, setOutsideChosen] = useState(false);
  const outside = value.assigneeId ? false : outsideChosen || value.assigneeName !== null;

  const reactId = useId();
  const searchId = `${reactId}-search`;
  const nameId = `${reactId}-name`;

  const selectedUser = value.assigneeId ? users.find((u) => u.id === value.assigneeId) ?? null : null;
  const shown = filterUsers(users, query);

  function pickUser(id: string) {
    setOutsideChosen(false);
    onChange({ assigneeId: id, assigneeName: null });
  }

  function chooseOutside() {
    setOutsideChosen(true);
    setQuery("");
    onChange(NOBODY);
  }

  function backToStaff() {
    setOutsideChosen(false);
    onChange(NOBODY);
  }

  function clear() {
    setOutsideChosen(false);
    setQuery("");
    onChange(NOBODY);
  }

  // ── Someone outside the team: a text field ─────────────────────────────────────────────
  if (outside) {
    const typed = value.assigneeName ?? "";
    return (
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-[11px] font-medium text-slate-600">
          Name of the person outside the team
        </label>
        <input
          id={nameId}
          type="text"
          value={typed}
          maxLength={OUTSIDE_MAX}
          disabled={disabled}
          autoComplete="off"
          placeholder="e.g. Deekshith (external accountant)"
          // Raw text, so a space between two words survives the keystroke; blank becomes null so
          // a caller never sends an empty name.
          onChange={(e) => {
            const raw = e.target.value.slice(0, OUTSIDE_MAX);
            onChange({ assigneeId: null, assigneeName: raw.trim() ? raw : null });
          }}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={backToStaff}
            disabled={disabled}
            className="min-h-[44px] px-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 focus-ring rounded"
          >
            Pick a staff member instead
          </button>
          <span className="text-[10px] text-slate-400 tabular-nums">
            {typed.length}/{OUTSIDE_MAX}
          </span>
        </div>
      </div>
    );
  }

  // ── A staff member: a searchable list, "Someone outside the team…" last ──────────────────
  return (
    <div className="space-y-1.5">
      {value.assigneeId && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 min-h-[44px]">
          <span className="text-xs text-blue-900 truncate">
            <span className="text-blue-700">Chosen: </span>
            <span className="font-semibold">{selectedUser?.name ?? "A staff member no longer listed"}</span>
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label="Clear the choice"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-blue-600 hover:text-blue-800 disabled:opacity-50 focus-ring rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          Search staff
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          disabled={disabled}
          autoComplete="off"
          placeholder="Search staff…"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 pl-9 pr-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Who chases it"
        className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100"
      >
        {shown.length === 0 && (
          <p className="px-3 py-3 text-xs text-slate-500">
            {users.length === 0 ? "No staff to pick from." : "No staff member matches."}
          </p>
        )}
        {shown.map((u) => {
          const checked = u.id === value.assigneeId;
          return (
            <button
              key={u.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => pickUser(u.id)}
              className={cn(
                "w-full min-h-[44px] flex items-center gap-2 px-3 text-left text-sm transition-colors disabled:opacity-50 focus-ring",
                checked ? "bg-blue-50 text-blue-900 font-medium" : "text-slate-700 hover:bg-slate-50"
              )}
            >
              <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="flex-1 truncate">{u.name}</span>
              {checked && <Check className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />}
            </button>
          );
        })}
        {/* Always last, and never filtered away by the search — the way to name an outsider. */}
        <button
          type="button"
          role="radio"
          aria-checked={false}
          disabled={disabled}
          onClick={chooseOutside}
          className="w-full min-h-[44px] flex items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 focus-ring"
        >
          <UserPlus className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="flex-1">Someone outside the team…</span>
        </button>
      </div>
    </div>
  );
}
