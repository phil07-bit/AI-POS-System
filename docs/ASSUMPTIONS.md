# Assumptions (to confirm with the product owner)

- **Billing periods** are anchored on the lease start date. A final partial period is pro-rated by days. `custom` frequency generates no charges (add them manually).
- **Due date** is the period start, or `dueDay` of that month when set (clamped to month length). Grace days affect "overdue" status only.
- **Lease dates are inclusive.** A lease ending 31 Dec and one starting 1 Jan on the same unit do not overlap.
- **Termination** date must be today or earlier; unpaid charges for periods after it are voided automatically. Deposits are tracked as a status only, not as ledger money.
- **Renewal** creates a new linked draft lease starting the day after the old one ends.
- **Payments must reference a lease** in this MVP (no tenant-level unallocated payments).
- **Allocation default** is oldest due date first; staff can allocate manually. Over-payment stays as unapplied credit on the lease and is applied to later charges.
- **Payments require confirmation** before they count (org policy `paymentsRequireConfirmation`, on by default). Pending payments do not reduce arrears.
- **Arrears aging** buckets are by days past due date: 0–30, 31–60, 61–90, 90+.
- **Occupancy** = units with an active lease covering the date ÷ rentable units (units marked unavailable or under maintenance are excluded; reserved units count as rentable but vacant). Rate is "n/a" when there are no rentable units.
- **Timezone** for "today" is the organization's timezone (default Africa/Accra, UTC+0, no DST).
- **Phone numbers** are normalised to +233 format when entered in local form (e.g. 024…).
- **Receipt numbers** are sequential per organization and year (RCT-2026-000001); charge refs CHG-2026-00001.

## Phase 4 (facilities)

- **Default target dates** when none is set: emergency 1 day, high 3, normal 7, low 14.
- **"Due soon"** for assets and plans means within 14 days; overdue means the due date has passed.
- **Repeat repairs** are flagged at 3+ reactive work orders of the same category on one asset (or unit, when no asset) within 90 days.
- **Vendor response time** = assigned → started; completion time = assigned → completed. Report completion time = raised → completed.
- **Tenants** can report problems only for units on their active or pending-signature leases, see only tenant-visible updates
  (never internal notes), and can rate work once completed.
- **Photos/attachments** on requests and before/after images on work orders are deferred to the documents module (phase 5),
  which brings private storage. Vendor contract documents likewise.
- **No vendor bank details** are collected (spec §4.8): there is no accounts-payable module.
