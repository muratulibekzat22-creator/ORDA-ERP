# Finance integrity

Canonical definitions:

- `contractValue`: current controlled commercial value of an order (`Order.amount`).
- `cashReceived`: client payments less refunds, calculated from immutable `Payment` rows.
- `receivable`: `contractValue - cashReceived`.
- `recognizedRevenue`: contract value of completed orders; it is not cash received.
- `COGS` / `directCost`: order calculation and consumed-material costs. Purchase Batch/Landed Cost is intentionally out of scope.
- `grossMargin`: recognized revenue less direct cost.
- `operatingExpense`: canonical `CompanyLedgerEntry(direction=EXPENSE)` total.
- `operatingProfit`: gross margin less operating expense.
- `partnerPayable`: agreed partner price for the current assignment.
- `partnerPaid`: immutable partner payouts less their reversals.
- `netCashFlow`: cash receipts plus other cash income, less refunds, partner payouts, and company ledger cash expenses.

`Payment(EXPENSE)` is legacy-compatible only. New operating expenses must be posted to `CompanyLedgerEntry`; combined reporting must deduplicate legacy rows before including them. Existing rows are retained.

Order mirror fields (`prepayment`, `balance`, `partnerPaid`, `partnerBalance`, `companyProfit`) are projections. `Payment` and controlled commercial/partner adjustments are authoritative. `reconcileOrderFinance` detects and optionally repairs drift.

Posted finance and warehouse operations are immutable. Corrections use linked reversal rows. Orders with financial or operational history are closed through business status, not hard-deleted.

Legacy monetary fields still requiring a separate migration strategy: warehouse quantities and reservation quantities (`Float`), stock/minimum stock (`Float`), and legacy client display amount (`String`). They are not converted in this P0 migration.
