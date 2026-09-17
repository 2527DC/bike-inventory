"use client";

import { ChevronDown, ChevronRight, Check, GitMerge, Pencil, Power, Tag, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryTreeSelect, type CategoryTreeSelectRow } from "@/components/category-tree-select";

/** A row as GET /api/categories?includeInactive=1 returns it. */
export interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  reorderLevel: number;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  /**
   * A category is never deleted (owner, 8 Sep 2026). Inactive hides it from every picker
   * and sets its products — and its sub-categories, with theirs — inactive; every row stays.
   */
  isActive: boolean;
  _count: { products: number; children: number };
}

interface CategoryRowProps {
  category: CategoryItem;
  depth: number;
  /** Children shown under this row in the current filter — drives the chevron. */
  visibleChildren: number;
  expanded: boolean;
  onToggleExpand: () => void;
  /** The row's parent is hidden by the status filter, so say where it sits. */
  showParentHint: boolean;

  mayEdit: boolean;
  mayMerge: boolean;
  busy: boolean;

  editing: boolean;
  draftName: string;
  onDraftName: (v: string) => void;
  draftParentId: string | null;
  onDraftParentId: (v: string | null) => void;
  /** Rows the parent picker may offer (active, plus the current parent). */
  parentOptions: CategoryTreeSelectRow[];
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;

  merging: boolean;
  mergeTargets: CategoryTreeSelectRow[];
  mergeTarget: string;
  onMergeTarget: (v: string) => void;
  onStartMerge: () => void;
  onMerge: () => void;
  onCancelMerge: () => void;

  onToggleActive: () => void;
}

/** Indentation per tree level. Capped so a deep branch still fits a 375px screen. */
const indent = (depth: number) => Math.min(depth, 4) * 16;

export function CategoryRow(props: CategoryRowProps) {
  const {
    category: c, depth, visibleChildren, expanded, onToggleExpand, showParentHint,
    mayEdit, mayMerge, busy, editing, merging,
  } = props;

  return (
    <Card className={c.isActive ? "" : "opacity-60"} style={{ marginLeft: indent(depth) }}>
      <CardContent className="p-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Input
              value={props.draftName}
              onChange={(e) => props.onDraftName(e.target.value)}
              className="min-h-[40px]"
              aria-label="Category name"
              autoFocus
            />
            <div>
              <label htmlFor={`parent-${c.id}`} className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Parent
              </label>
              <CategoryTreeSelect
                id={`parent-${c.id}`}
                categories={props.parentOptions}
                value={props.draftParentId}
                onChange={props.onDraftParentId}
                // Itself and everything under it are left out: either would make a loop.
                excludeIds={[c.id]}
                placeholder="Top level (no parent)"
              />
            </div>
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" onClick={props.onSaveEdit} disabled={busy} aria-label="Save">
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={props.onCancelEdit} aria-label="Cancel">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {visibleChildren > 0 ? (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${c.name}`}
                className="-ml-1 min-h-[36px] min-w-[28px] inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-ring"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <Tag className="h-4 w-4 text-slate-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-slate-900 break-words">{c.name}</p>
                {!c.isActive && <Badge variant="danger" className="text-[10px]">Inactive</Badge>}
                <Badge variant="info" className="text-[10px] tabular-nums">
                  {c._count.products} product{c._count.products === 1 ? "" : "s"}
                </Badge>
                {c._count.children > 0 && (
                  <Badge variant="default" className="text-[10px] tabular-nums">
                    {c._count.children} sub
                  </Badge>
                )}
              </div>
              {((showParentHint && c.parent) || c.description) && (
                <p className="text-[11px] text-slate-500 mt-0.5 break-words">
                  {[showParentHint && c.parent ? `in ${c.parent.name}` : null, c.description]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              {mayEdit && (
                <IconBtn label={`Edit ${c.name}`} onClick={props.onStartEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {mayMerge && props.mergeTargets.some((t) => t.id !== c.id) && (
                <IconBtn label={`Merge ${c.name} into another category`} onClick={props.onStartMerge}>
                  <GitMerge className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {mayEdit && (
                <IconBtn
                  label={c.isActive ? `Deactivate ${c.name}` : `Activate ${c.name}`}
                  tone={c.isActive ? "amber" : "green"}
                  disabled={busy}
                  onClick={props.onToggleActive}
                >
                  <Power className="h-3.5 w-3.5" />
                </IconBtn>
              )}
            </div>
          </div>
        )}

        {merging && (
          <div className="mt-2 pt-2 border-t border-slate-200">
            <p className="text-[11px] text-slate-600 mb-1.5">
              Move {c._count.products} product{c._count.products === 1 ? "" : "s"} from{" "}
              <strong>{c.name}</strong> into another category, then delete <strong>{c.name}</strong>.
              This cannot be undone.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <CategoryTreeSelect
                className="flex-1"
                categories={props.mergeTargets}
                value={props.mergeTarget || null}
                onChange={(id) => props.onMergeTarget(id ?? "")}
                excludeIds={[c.id]}
                placeholder="Merge into…"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={props.onMerge} disabled={!props.mergeTarget || busy}>
                  {busy ? "Merging…" : "Merge"}
                </Button>
                <Button size="sm" variant="outline" onClick={props.onCancelMerge}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IconBtn({
  label, onClick, children, tone, disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /** amber = about to take something away, green = about to bring it back. */
  tone?: "amber" | "green";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 focus-ring ${
        tone === "amber" ? "text-amber-600" : tone === "green" ? "text-green-600" : "text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
