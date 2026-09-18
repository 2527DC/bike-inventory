"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface StepShellProps {
  title: string;
  /** "Step 2 of 4", or descriptive text. */
  subtitle?: string;
  onBack: () => void;
  badge?: string;
  children: ReactNode;
  /** The forward button(s). Rendered below the content with room to tap. */
  footer?: ReactNode;
}

/**
 * One screen of the stepper: back arrow, title, subtitle, content, footer.
 */
export function StepShell({ title, subtitle, onBack, badge, children, footer }: StepShellProps) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="p-2.5 -ml-2 rounded-lg hover:bg-slate-100 focus-ring min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {badge && (
          <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 tabular-nums">
            {badge}
          </span>
        )}
      </div>

      <div className="space-y-4">{children}</div>

      {footer && <div className="mt-6 space-y-2">{footer}</div>}
    </div>
  );
}
