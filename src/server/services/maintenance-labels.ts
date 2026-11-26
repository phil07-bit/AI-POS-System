/** Plain-language labels shared by services (timeline text) and UI. */
export function humanizeStatus(s: string): string {
  return s.replace(/_/g, " ");
}

/** Tenant-facing wording for request statuses: avoids internal jargon. */
export const TENANT_STATUS_LABEL: Record<string, string> = {
  submitted: "Received", triaged: "Being reviewed", approved: "Approved", assigned: "Scheduled",
  in_progress: "Work in progress", waiting_for_parts: "Waiting for parts", completed: "Work completed",
  closed: "Closed", rejected: "Not approved", cancelled: "Cancelled",
};
