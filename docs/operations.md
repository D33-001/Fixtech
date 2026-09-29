# Operations — Fixtech Demo v1.8

## Database

1. สร้างฐาน PostgreSQL ว่างแยกสำหรับ Demo ห้ามใช้ฐาน production หรือฐาน FixTech v4.
2. ใช้บัญชี migration รัน `release/FixTech-demo-v1.8.database.sql` ด้วย `ON_ERROR_STOP=1` ตาม [คู่มือติดตั้ง](../release/README.md).
3. ตรวจว่า schema ติดตั้งครบ 26 ตารางและไม่มี transaction ค้าง; ถ้าคำสั่งล้มเหลว ตรวจว่า transaction rollback แล้วก่อนแก้และติดตั้งใหม่.
4. เก็บ connection string และ secrets ใน `.env` ที่ถูก ignore; ห้าม commit. สำหรับ Demo ให้ใช้เฉพาะฐาน local แบบ disposable. การใช้ role เจ้าของฐานอนุญาตได้เฉพาะเครื่องนักศึกษา/ฐานทิ้งได้เท่านั้น; ห้ามนำ credential นี้ไปใช้กับฐานร่วม, server สาธารณะ หรือ production ซึ่งต้องแยก app role แบบ least privilege.
5. seed เฉพาะผู้ใช้และข้อมูลสังเคราะห์ตาม Data Model; reset ลบเฉพาะข้อมูล Demo ไม่ลบ schema/migration.

## App connection and end-to-end tests

The app reads `DATABASE_URL` and `SESSION_SECRET` when `npm start` launches; `/api/health/ready` verifies connectivity plus all 26 required tables. From the project root in PowerShell, copy `.env.example` to `.env`, set a local `DATABASE_URL`, a unique `SESSION_SECRET` (at least 32 bytes), and `DEMO_SEED_PASSWORD` (at least 12 characters). Run `npm run setup:check -- --before-seed` to check secrets, local PostgreSQL authentication and schema without printing credentials. If this is a new empty Demo database, set `DEMO_SEED_ALLOW_MUTATION=yes` only for the seed command; seed is disabled under `NODE_ENV=production`, requires the explicit password, and never prints it. Run `npm run setup:check` after seeding to confirm all eight accounts/four roles. Keep the web server window open after `npm start`, then visit `http://localhost:3000`.

To run the full PostgreSQL workflow test, set `FIXTECH_TEST_DATABASE_URL` to a disposable, seeded test database, set `DEMO_SEED_PASSWORD` to its seed password, and explicitly set `FIXTECH_TEST_DATABASE_ALLOW_MUTATION=yes`; run `npm test`. The integration test creates synthetic jobs, offers, chat, payments, reviews and claims, so never target shared/valuable data. Without `FIXTECH_TEST_DATABASE_URL`, Node skips the PostgreSQL integration case. Never store either mutation acknowledgement in `.env`, source control, or a production environment. Also run `npm run check` and `python -m unittest tests/check_demo_v18_schema.py`.

For example in PowerShell, after `.env` is configured and the schema is installed:

```powershell
$env:DEMO_SEED_PASSWORD = 'your-private-local-demo-password'
$env:DEMO_SEED_ALLOW_MUTATION = 'yes'
npm run seed
$env:DEMO_SEED_ALLOW_MUTATION = $null
$env:FIXTECH_TEST_DATABASE_URL = 'postgres://fixtech_demo:password@localhost:5432/fixtech_demo_v18'
$env:FIXTECH_TEST_DATABASE_ALLOW_MUTATION = 'yes'
npm test
$env:FIXTECH_TEST_DATABASE_ALLOW_MUTATION = $null
```

Replace both URLs with the exact disposable database you installed and seeded. Keep the allow-mutation variables temporary and verify the target before setting them. Do not commit `.env` or use the sample credentials outside local development. The app-level `DATABASE_URL` is not automatically the integration test target.

## Files and retention

ใช้ private local storage สำหรับ Demo, บังคับตรวจ MIME/signature/ขนาด/สิทธิ์, ไม่เสิร์ฟไฟล์จาก public path และลบข้อมูลทดสอบจาก active storage ภายใน 30 วันหลังประเมินตาม SRS NFR-016. ห้ามใช้ข้อมูลจริงของลูกค้าหรือเอกสารยืนยันตัวตนจริง.

## Local AI and curated estimate source

1. Install Ollama locally, then run `ollama pull gemma3:4b` and `ollama run gemma3:4b` to verify the model. Keep Ollama listening on loopback (`127.0.0.1:11434`). The app refuses to start with `AI_PROVIDER=ollama` when `NODE_ENV=production`; this adapter is Demo-only and is not an approved production AI deployment.
2. Set `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=gemma3:4b`, and `AI_TIMEOUT_MS=120000` in ignored `.env`. If unavailable, AI fails closed and the Job remains Draft.
3. Set `MARKET_PRICE_PROVIDER=curated_demo`. Curated references are accepted for at most 30 days from their recorded `reviewedAt`; the live-source `MARKET_PRICE_MAX_AGE_HOURS` setting (default 24) does not extend this curated window. A developer must recheck the actual cited sources and update the catalog review date before the 30-day boundary; reads must never refresh that date. This is not a live API, market survey, or Fixtech quote.
4. Check `/api/demo/status`; perform one analyze and one AI follow-up with synthetic text/image, then record machine, model, date and outcome in `docs/validation.md`. Unit tests do not prove model availability or quality.

For stale-price UI testing only, `FIXTECH_TEST_CURATED_REVIEWED_AT` can override the curated review timestamp when `NODE_ENV=test`; do not set this variable in development/demo or production. The override is ignored outside test mode.

If a service has no valid reference mapping, do not invent a value: return `ESTIMATE_UNAVAILABLE` and require manual review.

## Legacy v4

v4 database และวิธีสำรอง/กู้คืนเดิมถูกเก็บใน `archive/fixtech-v4/`. คำสั่ง/manifest ของ v4 ไม่ใช่ขั้นตอนของ Demo v1.8. ไม่มีการย้ายข้อมูลอัตโนมัติจาก schema v4.
