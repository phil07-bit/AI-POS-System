# AI-POS interactive demo (browser-only)

A shareable, self-contained version of AI-POS for partners and prospective clients. It runs entirely in
the browser: no server, database, API keys or secrets. Data is the fictional "Caxaze Property Solutions"
portfolio (3 properties in Accra and Kumasi, 17 units, 12 tenants), re-seeded each day relative to today
and saved only in the viewer's `localStorage`. "Reset demo data" in the banner restores it.

## What it demonstrates

| Area | Behaviour (mirrors the real app's rules) |
| --- | --- |
| Roles | 9 one-click demo logins using the same permission keys as `src/lib/permissions`; property-scoped users (Kumasi manager, landlord) see only Adum Heights; technicians see only their own jobs |
| Rent | Monthly / quarterly / half-yearly / yearly billing in integer pesewas; advance payments held as credit and applied to new charges |
| Payments | MTN MoMo, Telecel Cash, AT Money, bank, cheque, cash; duplicate-reference guard; maker-checker (recorder vs. finance confirmation); receipts on confirmation; reversals as compensating entries |
| Arrears | Aging by days past due (0–30, 31–60, 61–90, 90+), oldest-debt-first allocation, mock email reminders |
| Leases | Draft → pending signature → active → terminated (future unpaid charges voided), renewals, overlap checks |
| Facilities | Requests (staff and tenant portal) → triage/approve/reject → work orders (assigned → in progress → waiting for parts → completed → closed), costs, vendors, assets, preventive plans |
| Other | Tenant portal, audit log, notifications outbox (mock provider), reports and CSV export, AI assistant (mock, rule-based) |

It is a demo, not the production system: there is no real authentication and no shared data. The
production app is the Next.js + PostgreSQL code in this repository.

## Run locally

```bash
cd demo && python3 -m http.server 8080   # then open http://localhost:8080
```

## Deploy

It is a static site (`index.html`, `styles.css`, `engine.js`, `app.js`); `netlify.toml` publishes this folder as-is.

- **Netlify (Git):** New project → Import from GitHub → this repo, base directory `demo`, no build command.
- **Netlify Drop:** drag the `demo` folder onto https://app.netlify.com/drop.
- **Single file:** `python3 demo/build-single.py out.html` bundles everything into one HTML body
  (used for the claude.ai artifact version; that build hides Print and CSV export, which embedded viewers block).

Make sure the site's visitor access is public (no team login / password) if clients should open it.
