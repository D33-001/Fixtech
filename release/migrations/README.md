# Production foundations migration

`0001_production_foundations.sql` adds eight tables to a Fixtech Demo v1.8 schema. It is a **foundation**, not an instruction to turn on production mode or accept money.

Apply it first on a new disposable PostgreSQL database after installing `release/FixTech-demo-v1.8.database.sql`:

```powershell
psql -X -v ON_ERROR_STOP=1 -d YOUR_DISPOSABLE_DATABASE -f release/migrations/0001_production_foundations.sql
```

Check `SELECT version FROM schema_migrations;` and `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';`. Expected values are `0001_production_foundations` and `34`. The migration runs in one transaction. It is deliberately applied once; do not rerun it or apply it to a valuable database without backup and target verification. There is no migration from FixTech v4.

The eight tables cover verification cases/events, provider rate cards, market reference snapshots, payment intents/webhook events/refunds and migration history. They store no raw ID-card, face image, card number or full webhook payload. Settlement accounting and payout tables require a confirmed merchant contract and are not included yet.

Integration checks for the new services require a disposable database named exactly `fixtech_prod_migration_check` on loopback, with the base DDL and this migration installed. Set `FIXTECH_PRODUCTION_TEST_DATABASE_URL` and `FIXTECH_PRODUCTION_TEST_DATABASE_ALLOW_MUTATION=yes` only for that test run. Never point them at a database containing valuable data.
