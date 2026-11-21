# FIXI Command Center

Private global administration at `/admin`, using the existing React/Vite client and ASP.NET JWT/refresh-cookie authentication. No production deployment or privileged production account is created by this change.

## Design provenance

Kiranism `next-shadcn-dashboard-starter`, commit `89f4e257650905a3a206f8449757f981bb811306`:
https://github.com/Kiranism/next-shadcn-dashboard-starter

The sidebar/header/inset, card, analytics and table composition are adapted to Fixi's React 18 / Tailwind 3 runtime. `Card.tsx` adapts the upstream card primitives; the MIT notice is distributed at `/licenses/Kiranism.txt`. Clerk, Next.js server routing, template sample products, organizations and billing are deliberately replaced by Fixi's existing authentication, tenant models and real API contracts. No old PMS layout is used.

## Owner access

Migration `20261121025755_CommandCenter` adds a false-by-default `users.IsSuperAdmin` and the MXN `platform_plan_prices` table. Migration `20261121032302_PlatformShopSuspension` adds a false-by-default global suspension flag, independent of operational branch activation. Neither grants anyone access or changes existing trials or provider contracts.

After an authorized deployment and migration, an operator with server access can explicitly grant an existing, active, verified account:

```text
dotnet RepairShop.Api.dll admin superadmin <existing-email> grant
dotnet RepairShop.Api.dll admin superadmin <existing-email> revoke
```

Both commands rotate the security stamp, revoke refresh sessions and audit the change. A new sign-in is required. No web endpoint can grant this privilege. Global accounts cannot be reset, edited, disabled or granted shop access by tenant administrators.

## Boundaries

- `/api/v1/admin/*` rechecks the active user's database privilege and security stamp on every request. Responses are `no-store`.
- All ordinary tenant routes retain their tenant permissions and filters; a SuperAdmin token does not bypass them.
- Suspended shops fail token validation even with a primed security-stamp cache. Suspending a principal organization blocks its branches too; reactivation preserves each branch's individual state. Tenant administrators cannot clear global suspension.
- Global mutations require reasons, use one transaction plus an advisory lock and optimistic timestamps, and persist audit with the changes.
- Global audit events are excluded from tenant query filters. The owner-only endpoint explicitly reads them.
- Registration provisions a Mexican shop, normal owner invitation and exact 15-day Pro trial. It never exposes invitation or reset tokens in the panel. Delivery uses the configured notification outbox.
- Catalog price edits affect future MXN checkouts through shared pricing. Existing provider contracts are preserved. Provider-managed subscriptions cannot be overwritten by local grants or cancellations.
- MRR uses real active subscription amounts, separated by currency. Confirmed collected SaaS revenue is unavailable because the current model has no receipt ledger; shop sales and repair payments are never counted as platform income.

## Repeatable verification

Backend: set `REPAIRSHOP_TEST_CONNECTION` to a disposable PostgreSQL server, then `dotnet test backend/RepairShop.sln -c Release`. Integration tests create/drop their own isolated databases.

Frontend: `npm run lint`, `npm test`, `npm run build` from `frontend`. New deployments default to 15 trial days; an existing deployment's explicit `TRIAL_DAYS` override must also be 15 to apply that policy to future public signups. Historical trial deadlines are unchanged.

Browser: point `E2E_BASE_URL` at isolated loopback QA and set `E2E_SUPERADMIN_EMAIL` / `E2E_SUPERADMIN_PASSWORD` to an explicitly granted QA owner, then run `npx playwright test e2e/command-center.spec.ts --headed`. Authentication traces/videos are disabled; credentials are not committed. The suite rejects non-loopback targets. Never target production with this suite.
