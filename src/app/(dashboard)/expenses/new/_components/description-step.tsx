"use client";

import { Button } from "@/components/ui/button";

const MAX_LENGTH = 500;

interface DescriptionStepProps {
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
}

/** Step 3 — what the money went on. Free text; forward is blocked while it is empty. */
export function DescriptionStep({ value, onChange, onNext }: DescriptionStepProps) {
  const valid = value.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onNext();
      }}
    >
      <label htmlFor="expense-description" className="block text-sm font-medium text-slate-700 mb-2">
        What was it for?
      </label>
      <textarea
        id="expense-description"
        autoFocus
        rows={3}
        maxLength={MAX_LENGTH}
        placeholder="e.g. tea for the counter, tempo to Ludhiana"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter keeps a newline for the rare long note.
          if (e.key === "Enter" && !e.shiftKey && valid) {
            e.preventDefault();
            onNext();
          }
        }}
        className="flex w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
      <p className="mt-1 text-[11px] text-slate-400 text-right tabular-nums">{value.length}/{MAX_LENGTH}</p>

      <Button type="submit" size="lg" disabled={!valid} className="w-full min-h-[48px] mt-6">
        Next
      </Button>
    </form>
  );
}
