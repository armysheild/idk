# Vahana operations runbook

## Production rollout

1. Create a Supabase project and private `documents` Storage bucket.
2. Set `VAHANA_ENVIRONMENT=production`, the Supabase PostgreSQL URL, `VAHANA_AUTH_PROVIDER=supabase`, `VAHANA_SUPABASE_JWT_SECRET`, and a non-default seed password.
3. Set `VAHANA_SUPABASE_SERVICE_ROLE_KEY` only in the API environment, never in Vite or browser configuration.
4. Set `VAHANA_CORS_ORIGINS` to the deployed web origin and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the web build environment. The backend service-role key is required for provisioning Supabase Auth users during signup, invitation acceptance, and owner-created user flows; never expose it to the browser.
5. Run `npm run migrate` from the release artifact before starting Uvicorn.
6. Configure Razorpay plan IDs, the server-side key secret, and a webhook for `/api/v1/webhooks/razorpay`.
7. Configure SMS and WhatsApp provider credentials, sender IDs, approved templates, and recipient opt-in policy when mobile delivery is enabled. For Twilio, set the provider to `twilio` plus the account SID, auth token, and SMS/WhatsApp sender numbers; the API derives the Messages endpoint when no custom URL is provided. Keep all provider credentials in the API environment.
8. Start the API with a process supervisor, expose `/health` for liveness, and use `/ready` for database-backed readiness.

The default local storage adapter is intentionally explicit. Production should use `VAHANA_STORAGE_BACKEND=supabase` with a private bucket and the service-role key held only by the API.

## Telematics destinations and credentials

Set `VAHANA_TELEMATICS_PROVIDER_HOSTS` to a JSON object mapping normalized provider names to approved HTTPS hostnames. Synchronization fails closed until a provider host is approved. Only port 443 and public resolved addresses are permitted; redirects are not followed.

Prefer encrypted integration tokens with `VAHANA_TELEMATICS_CREDENTIAL_KEY`. For centrally managed tokens, set `VAHANA_TELEMATICS_CREDENTIALS` to a JSON object keyed by organization ID, then credential reference. An integration can only resolve references inside its own organization. Existing direct environment-variable references must be moved to this registry.

## Purchase-order receipts

Receipts require an invoice number, actual unit cost, and an active receiving location from the same organization. The ordered price remains on the purchase-order line; each receipt stores the actual price. Only undamaged units enter stock, using a weighted average of the existing stock value and the receipt cost. Damaged units still count as delivered against the order; backorders describe the remaining unreceived quantity and do not add stock. An order becomes received only when every line has its full delivered quantity.

Use `Idempotency-Key` when submitting receipts so a repeated request cannot add the same shipment twice. Cumulative quantities remain bounded by each order line.

## Scheduled processing and readiness

Vercel calls `GET /api/v1/telematics/cron-sync` daily at 00:00 UTC. Configure `CRON_SECRET` in the Production environment; Vercel sends it as a bearer authorization header. The API also accepts the existing `VAHANA_TELEMATICS_CRON_SECRET` for manual POST invocations. If both are set, `CRON_SECRET` takes precedence. Scheduled processing retains telematics sync, due maintenance generation, compliance expiry notifications, and queued SMS/WhatsApp delivery.

`/ready` and `/api/ready` route to the backend database readiness check. `/health` is the process health check.

## Deploying the audit fixes

Apply Alembic migrations through `x013` before deploying the matching application: `python -m alembic -c backend/alembic.ini upgrade head` with the production `VAHANA_DATABASE_URL`. `x012` freezes work-order labor-rate snapshots and adds reconciliation evidence; `x013` snapshots template tasks and links applied maintenance plans. Confirm `alembic current`, `/ready`, and a protected finance request after deployment. Take a database backup first; rollback the application and migrations together using the previous revision if necessary.

Create organization-specific maintenance templates in the Fleet Manager vehicle workspace. Applied plans keep their saved task and interval snapshots even after a template is changed or archived. Fuel efficiency is returned as unavailable until sufficient distance and fuel evidence exists; role dashboard inventory metrics are unavailable for roles without inventory access.

Example structure (replace placeholders with verified provider hosts and secrets):

```text
VAHANA_TELEMATICS_PROVIDER_HOSTS={"provider-name":["api.provider.example"]}
VAHANA_TELEMATICS_CREDENTIALS={"organization-id":{"provider-token":"token-value"}}
```

## Backup and recovery

- Back up PostgreSQL with daily full backups and point-in-time recovery.
- Version document objects independently with retention and encryption enabled.
- Test a restore into an isolated database at least monthly.
- Restore the database first, then the document objects, then run `npm run migrate`.
- Verify `/health`, `/ready`, authentication, document downloads, and a tenant-scoped read before traffic is restored.
- Run `VAHANA_BACKUP_SOURCE_URL=... VAHANA_RESTORE_TARGET_URL=... python -m backend.app.backup_restore` against an isolated PostgreSQL target to verify both database and restore tooling. Set `VAHANA_BACKUP_FILE` to choose the temporary custom-format dump path.

## Observability

Every response includes `x-request-id`. API logs emit structured request completion fields: request ID, method, path, status, and duration. Forward these fields to the deployment log collector and alert on sustained 5xx responses, migration failures, database saturation, and storage errors.
