# Backup and recovery runbook

## Scope

Production data consists of the PostgreSQL database, Supabase Storage evidence,
Supabase Auth identities, and the Alembic migration history. All recovery work
must preserve tenant-scoped records and audit history.

## Backup requirements

- Enable and monitor automated PostgreSQL backups and point-in-time recovery.
- Export Supabase Storage metadata and verify document objects and checksums.
- Keep Auth configuration, redirect URLs, and provider settings documented
  without exporting credentials.
- Record the deployed Alembic revision with every release.

## Migrations

Apply migrations with Alembic and record the resulting revision before restoring
application traffic.

## Restore procedure

1. Create an isolated recovery project; never overwrite the production project.
2. Restore PostgreSQL to the target recovery point.
3. Apply Alembic migrations and confirm the expected revision.
4. Restore Storage evidence and verify SHA-256 checksums against document assets.
5. Confirm Auth configuration and test sign-in with a disposable account.
6. Verify tenant-scoped queries, role boundaries, audit events, inventory
   movements, work-order handoffs, and financial records.
7. Run the restore verification checklist before promoting the recovery system.

## Restore verification checklist

- PostgreSQL connectivity and migration status.
- Storage evidence download and SHA-256 verification.
- Auth sign-in, password recovery, and invitation redemption.
- Tenant-scoped reads and cross-tenant denial.
- Owner, Fleet Manager, Inventory Manager, Mechanic, Technician, Driver, and
  Accountant workspace access.
- inventory adjustments reject stale expected quantities.
- financial corrections require reasoned reversals.
- Telematics credentials remain encrypted and provider mappings are intact.
- Notification delivery records remain auditable.

## Credential and destructive-operation policy

Never commit database exports, Auth exports, storage credentials, or signed URLs.
Do not overwrite the production project. Organization deletion is a controlled, destructive operation
destructive operation requiring an explicit approval and an independently
verified backup.
