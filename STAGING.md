# ORDA ERP staging deployment

## Scope

Use a Vercel Preview deployment or a Vercel custom environment named `staging`. Do not use `vercel deploy --prod`, configure a production domain, or point staging at a local or production database.

## Create the staging PostgreSQL database

1. Provision a dedicated PostgreSQL database for staging with a separate user and password.
2. Require TLS for the database connection.
3. Build its `DATABASE_URL` with `sslmode=require` when required by the provider.
4. Never use `localhost`, the development `.env` database, or a production connection string for staging.

## Required environment variables

Set these values in the Vercel Preview environment (or the `staging` custom environment):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Dedicated staging PostgreSQL connection string. |
| `NEXTAUTH_SECRET` | Long random secret used to sign NextAuth JWTs. |
| `NEXTAUTH_URL` | Exact generated staging deployment URL. |
| `FIRST_DIRECTOR_EMAIL` | Email used only for idempotent first-director provisioning. |
| `FIRST_DIRECTOR_PASSWORD` | Strong initial director password; do not commit it. |
| `FIRST_DIRECTOR_NAME` | Optional display name for the initial director. |

Example CLI setup for a Preview environment:

```bash
npx vercel link
npx vercel env add DATABASE_URL preview
npx vercel env add NEXTAUTH_SECRET preview
npx vercel env add NEXTAUTH_URL preview
npx vercel env add FIRST_DIRECTOR_EMAIL preview
npx vercel env add FIRST_DIRECTOR_PASSWORD preview
npx vercel env add FIRST_DIRECTOR_NAME preview
```

## Deploy

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed:director
npm run build
npx vercel deploy --logs
```

For a Vercel custom environment named `staging`, replace the final command with:

```bash
npx vercel deploy --target=staging --logs
```

Run migrations and the first-director seed once from a controlled CI job or terminal that uses the staging environment variables. Do not make migrations part of the concurrent Vercel build step. Vercel runs `vercel-build`, which generates Prisma Client and builds the Next.js app.

The bootstrap command creates a director only when no director exists and never resets an existing password. After the first login and mandatory password change, remove `FIRST_DIRECTOR_EMAIL`, `FIRST_DIRECTOR_PASSWORD`, and `FIRST_DIRECTOR_NAME` from Vercel Production and Preview.

## Verify the deployment

Replace `STAGING_URL` with the generated Vercel URL:

```bash
curl --fail --silent --show-error https://STAGING_URL/api/health
npm run test:api:security
npm run test:e2e:business
npm run test:idempotency
```

The health response is intentionally limited to `status` and `database`; it does not return a connection string, credentials, schema details, or internal errors.

## Roll back

1. In Vercel, promote the previously known-good deployment to the staging alias, or redeploy its commit as a Preview deployment.
2. Do not roll database migrations back automatically. Use a reviewed, explicit database rollback plan when a migration is incompatible.
3. Re-run the health and smoke checks after the rollback.
