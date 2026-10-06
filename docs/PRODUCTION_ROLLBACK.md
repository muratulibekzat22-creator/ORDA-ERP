# ORDA production backup and rollback runbook

## Before every release

1. Resolve and record the Vercel deployment ID, Git SHA, Neon project, branch, database and a SHA-256 fingerprint of `host|database`.
2. Create a Neon point-in-time branch before any migration.
3. Run `pg_dump --format=custom --no-owner --no-acl` over the direct TLS endpoint.
4. Encrypt the dump with AES-256-CBC/PBKDF2 (minimum 250,000 iterations). Store the key separately and never in Git, logs or deployment variables used by the application.
5. Decrypt into a temporary file, restore into a new isolated database and run `npm run verify:database-restore`.
6. Compare tenant IDs, critical row counts, orphan checks and financial sums before continuing.

## Application rollback

Vercel rollback reassigns the production alias to the last verified deployment. It does not restore PostgreSQL. Keep the previous Ready deployment until login, roles, orders, finance, files and offline synchronization have passed smoke tests.

## Database recovery

The security migration is additive. Do not run `prisma migrate reset` or `prisma db push`. For an application regression, roll code back while retaining the additive columns/tables. For data corruption, stop mutations, create a forensic branch at the incident timestamp, compare it with the pre-deploy snapshot, and restore only after owner approval. Prefer a forward repair or storno entry over deleting financial history.

## Retention and drills

- Provider history: at least 7 days, maximized for the existing plan.
- Encrypted daily logical backups: 30 days.
- Encrypted monthly backups: 12 months.
- Monthly restore drill into a separate database with schema/count/sum comparison.
- Any failed dump, encryption, upload, migration or restore verification is a release blocker and must notify the owner without including secrets or personal data.
