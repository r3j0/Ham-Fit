# Hamster outputter v2 catalog

Frontend request: `frontend/BACKEND-REQUESTS.md` at `6e600bf`.

The additive migration `20261001000400_hamster_outputter_v2` registers the
approved outputter assets and confirms sale prices. Permanent product IDs,
historical purchases, balances, ownership, saved outfits and existing
combinations are preserved. Existing commercial revisions advance when price
or sale metadata changes; clients must use the revision from `GET /api/v1/shop/products`.

| Price (seeds) | Product IDs                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 25            | `clothing.mint-shirt`                                                                                                                        |
| 50            | `pose.curious`, `pose.drink`, `pose.lying`, `pose.stretch`, `pose.droopy`, `pose.cant-hear`, `pose.foam-roller`, `pose.phone`, `pose.toilet` |
| 70            | `pose.passion`, `pose.victory`, `pose.run`, `pose.pushup`, `pose.situp`, `pose.weight`                                                       |

All sale prices have `priceProvisional=false`. Purchases with a provisional price
return `409 PRICE_NOT_CONFIRMED` without debiting seeds. Default characters and
`pose.basic` remain permanent default items without a sale price.

The four new poses (`foam-roller`, `phone`, `toilet`, `weight`) support cream and
gray without clothing. Shared `clothing.mint-shirt` occupies only `top` and is
registered exclusively for cream/basic and gray/basic. No unsupported poses,
hat/bottom assets or legacy sportswear combinations are registered.

`pose.a-plus` retains its permanent ID and render key with `saleStatus=retired`
and `price=null`. Fresh purchases are rejected and the existing personal
roulette candidate filter excludes it. Existing owners and the two legacy
combinations can still read/save their outfit, switch back to basic, and replay
successful historical purchases without another debit.

Personal/group roulette policies, probabilities, ticket issuance, result
history and idempotency remain unchanged. The existing personal item pool can
award the newly registered sale poses and mint-shirt. No signup recovery
feature is included.

Verification uses real PostgreSQL in disposable test schemas:

- `avatar-outputter.e2e-spec.ts`: catalog prices, all new pose combinations,
  shared mint-shirt purchase, slot restrictions, provisional/stale prices,
  a-plus retirement and existing personal roulette item awards/fallback.
- `avatar-outputter-migration.e2e-spec.ts`: every pre-existing non-catalog row,
  old combinations, default products, owned a-plus, its saved outfit,
  historical 60-seed purchases and completion receipt survive the migration.
- Existing avatar, workout, group mission and personal roulette tests verify
  their established contracts alongside the new daily seed grant.

Final verification: 353 unit tests and 528 PostgreSQL integration tests passed;
Prisma validation, lint, typecheck and production build passed. Formatting passed
with `prettier --check . --end-of-line auto` for the existing CRLF checkout.

This source change alone does not apply the migrations or replace a running
server. Deploy both new migrations with `npm run db:migrate:deploy` before
starting the updated backend. Historical completed routines are not backfilled;
see [activity-rewards.md](activity-rewards.md) for the receipt contract.
