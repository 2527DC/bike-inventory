import { redirect } from "next/navigation";

/**
 * /reorder moved inside Purchase Orders as its second tab (plan 1509-reorder-inside-purchase-
 * orders, R7 / Q8). This page is kept only so bookmarks, old links and a bottom-nav tab pinned
 * to /reorder still land somewhere: a server-side 307 to the tab. The screen itself is
 * `purchase-orders/_components/reorder-tab.tsx`.
 */
export default function ReorderRedirectPage() {
  redirect("/purchase-orders?tab=reorder");
}
