# Fixtech Demo v1.8

โครงตั้งต้นสำหรับทีม 3 คนพัฒนา Frontend และ Backend ต่อร่วมกันบน branch `Develop`. อ่าน [สารบัญขั้น 1–8](docs/README.md) และ [วิธีทำงานร่วมกัน](CONTRIBUTING.md). ไฟล์แชทอื่นและ archive รุ่นเก่าเก็บเฉพาะเครื่องเดิม ไม่รวมใน repository นี้.

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `public/` | Frontend: HTML, CSS, JavaScript |
| `src/` | Backend: Express API, auth, DB pool, ราคา, integrations |
| `scripts/` | เตรียมข้อมูลและตรวจการตั้งค่าเครื่อง |
| `tests/` | Unit/integration/schema tests |
| `release/` | DDL, SQL คำถามธุรกิจ, migration ทดลอง |
| `docs/` | ข้อกำหนด แบบระบบ หลักฐานทดสอบ และเอกสารอ้างอิง |

โครงการนี้ปรับจากฐานข้อมูล FixTech v4 เดิมมาเป็น Demo สำหรับรายวิชา โดยเปลี่ยนขอบเขตและ schema ตามเอกสาร SRS v1.8. สำเนาเอกสาร/ฐานข้อมูล/ชุดทดสอบ v4 ก่อนปรับอยู่ใน `archive/fixtech-v4/` และห้ามนำมาปะปนกับ Demo ปัจจุบัน.

## สถานะปัจจุบัน

- เอกสารขั้น 1–6 กำหนด SRS, Use Case/API, Activity Diagram, Data Model/ERD, API/Job State และ wireframes ตามลำดับ.
- `docs/fixtech-demo-v1.8-drawdb.sql` เป็น SQL สำหรับนำเข้า drawDB.
- `release/FixTech-demo-v1.8.database.sql` เป็น DDL สำหรับติดตั้ง schema ใหม่บนฐานว่าง มี 26 ตารางและครอบด้วย transaction.
- มี Node.js/Express app เชื่อม PostgreSQL พร้อมหน้าเว็บเข้าสู่ระบบและพื้นที่ทำงานแยกตามบทบาท; API ครอบคลุมร่างงาน/AI consent/ไฟล์/ประเมินราคา/matching หรือเลือกข้อเสนอ/แชต/แจ้งเตือน/นัดหมาย/ส่งงาน/รับประกัน/ชำระเงินจำลอง/รีวิว/ข้อพิพาท/Admin.
- `npm test` รันชุด integration กับ PostgreSQL ได้เมื่อกำหนด `FIXTECH_TEST_DATABASE_URL` และยืนยัน `FIXTECH_TEST_DATABASE_ALLOW_MUTATION=yes` ชั่วคราว; ให้ชี้เฉพาะฐานทดสอบที่ทิ้งได้. Ollama/local AI และ curated price reference มี adapter แยกจาก test doubles.
- ผลติดตั้ง DDL จริงและขอบเขตการทดสอบล่าสุดบันทึกใน [validation status](docs/validation.md).
- Demo ปัจจุบันใช้ Ollama/Gemma 3 4B แบบ local (loopback) และ curated public price references แบบ non-live ตาม SRS §13.7; AI quality ยังไม่รับรอง. ปิด AI โดยปริยายเมื่อยังไม่ตั้งค่า และห้ามอ้างราคาว่าเป็น real-time.
- UI ขั้น 6 ปรับ responsive layout และ dialog ของ workflow หลักแล้ว; consent ต้องมาก่อนอัปโหลดรูป. Browser walkthrough ครบ 4 บทบาทบนฐานทดสอบชั่วคราวตาม [validation report](docs/validation.md).
- งานเพิ่มสำหรับรุ่นใช้งานจริง ได้แก่ ชำระเงินจริง ราคาอ้างอิงที่อัปเดต ตรวจตัวตนช่าง security audit และ WCAG 2.2 AA มี [โครงแผนแยก](docs/production-expansion-v1.md); ยังไม่ได้เปิดใช้งานใน Demo.

## ขอบเขต Demo

เว็บภาษาไทยสำหรับลูกค้าทั่วไป, ลูกค้าบริษัท, ช่าง/ทีมช่างแบบ seed และ Admin; รองรับภาพ, AI วิเคราะห์พร้อม consent ผ่าน Ollama local, ตัวอย่างราคาอ้างอิงที่ทีมดูแล (ไม่ใช่ real-time market), matching, chat/in-app notification, นัดหมาย, payment simulation, warranty, review และ dispute. ไม่มี payment gateway/เงินจริง, SMS/email, วิดีโอ หรือ production deployment.

## เอกสารหลัก

- [สไลด์ CE385 สัปดาห์ที่ 8 — RESTful API, Validation และ Prisma/PostgreSQL](docs/references/สไลด์_สัปดาห์ที่8_RESTfulAPIและValidationและPrismaPostgres_CE385.pdf) — เอกสารประกอบการเรียนที่ใช้เป็นข้อมูลอ้างอิง; การเพิ่มไฟล์นี้ไม่ได้เปลี่ยนเทคโนโลยีหรือขอบเขต Demo ปัจจุบัน
- [ผลตรวจเทียบ Fixtech กับสไลด์ CE385/CE396 ที่ส่งมา](docs/course-slide-alignment-review.md)
- [SQL คำถามธุรกิจ 5 ข้อสำหรับฝึกนำเสนอ CE396](release/03-business-queries.sql) — อ่านอย่างเดียว; ให้รันตรวจบนฐาน Demo ที่ seed แล้วก่อนอ้างผล
- [SRS](docs/software-requirements-v1.md)
- [Use Case และ API](docs/mvp-demo-design-v1.md)
- [Activity Diagram](docs/mvp-activity-diagrams-v1.md)
- [ER Diagram และ Data Dictionary](docs/mvp-data-model-v1.md)
- [ขั้น 5 — API และกฎการเปลี่ยนสถานะงาน](docs/api-and-job-state-v1.md)
- [ขั้น 6 — Wireframe หน้าจอสำคัญ](docs/wireframes-v1.md)
- [ขั้น 7 — สูตรประเมินราคาและ Matching](docs/step-7-pricing-matching-decisions.md)
- [ขั้น 8 — แผนทำงานร่วมกัน 3 คนทีละส่วน](docs/step-8-three-person-work-plan.md)
- [ผลรีวิวและปรับประสิทธิภาพขั้น 1–7](docs/step-1-7-optimization-review.md)
- [โครงแผนขยายไปใช้งานจริง](docs/production-expansion-v1.md)
- [ผลตรวจความพร้อม Production ขั้น 1–7](docs/production-readiness-review.md)
- [แบบสร้าง Production ขั้น 1–7](docs/production-step-1-7-build-spec.md)
- [migration โครงข้อมูล Production](release/migrations/README.md)
- [คำถามสำหรับเปิดบัญชีผู้ให้บริการ](docs/provider-onboarding-questions.md)
- [ข้อกำหนด integration](docs/integration.md)
- [การติดตั้ง/การทำงาน](docs/operations.md)
- [แผนตรวจสอบ](docs/validation.md)

## Local development

1. Install dependencies with `npm install` (Node.js 22.9+), then stay in this project folder in PowerShell.
2. Create `.env` with `Copy-Item .env.example .env`, open it locally, and replace the sample values. `DATABASE_URL` must use credentials that can connect to the local disposable Demo database; `SESSION_SECRET` must be at least 32 bytes; `DEMO_SEED_PASSWORD` must be at least 12 characters. Never paste these secrets into chat or commit `.env`.
3. In pgAdmin, create a **new empty** database named `fixtech_demo_v18`, open Query Tool for that database, and run `release/FixTech-demo-v1.8.database.sql`. The app's database role must have the required table read/write privileges. Never install this DDL on v4, production, or valuable data.
4. Run `npm run setup:check -- --before-seed`. It checks local DB authentication and all 26 required tables without printing credentials. Fix any reported issue before continuing.
5. If this database has not been seeded, run the seed once:

   ```powershell
   $env:DEMO_SEED_ALLOW_MUTATION = 'yes'
   npm run seed
   Remove-Item Env:DEMO_SEED_ALLOW_MUTATION
   ```

   Seed uses the local `DEMO_SEED_PASSWORD` for all demo accounts and no longer prints the password. Do not seed repeatedly unless intentionally resetting a disposable demo database.
6. Run `npm run setup:check`, `npm run check`, `npm test`, and `python -m unittest tests/check_demo_v18_schema.py`. The PostgreSQL workflow test is skipped unless `FIXTECH_TEST_DATABASE_URL` is explicitly configured for a disposable test database.
7. Run `npm start` and keep that PowerShell window open. Then open `http://localhost:3000`; confirm `/api/health/ready` reports `ready` before logging in. All demo account passwords equal the local `DEMO_SEED_PASSWORD` value.

If Ollama/Gemma 3 4B is unavailable, set `AI_PROVIDER=disabled` in `.env`; the app can start but AI analysis is unavailable. For local AI, set `AI_PROVIDER=ollama` and run Ollama on loopback. Curated price references are not live market data; payment is simulation-only. This is a local student Demo, not a production deployment.

To verify the DDL on a real local PostgreSQL server, configure `SCHEMA_TEST_DATABASE_URL` in the ignored `.env` file with a migration account that can create databases, then follow [the disposable schema check](release/README.md). This is separate from the app's `DATABASE_URL`.

The Demo workflow and local Ollama path were runtime-tested against PostgreSQL 18.6 on a disposable database; the full workflow suite passed with no skips. This does not constitute production readiness or certify AI accuracy/safety, real payment, email/SMS, or all production security requirements; see [validation status](docs/validation.md).

## ข้อมูลเดิม

FixTech v4 เป็นระบบบริการหน้างานคนละขอบเขต ไม่ใช่ schema ของ Demo นี้. archive เก็บเฉพาะเครื่องเดิมและไม่รวมใน repository. การติดตั้ง v1.8 เป็น fresh schema เท่านั้น; ไม่มี migration/แปลงข้อมูลจริงจาก v4.
