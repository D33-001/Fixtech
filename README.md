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

## การติดตั้งและพัฒนาในเครื่อง

1. ติดตั้ง dependency ด้วย `npm install` โดยใช้ Node.js 22.9 ขึ้นไป แล้วเปิด PowerShell ค้างอยู่ในโฟลเดอร์โครงการนี้
2. สร้าง `.env` ด้วย `Copy-Item .env.example .env` แล้วเปิดไฟล์เพื่อเปลี่ยนค่าตัวอย่าง `DATABASE_URL` ต้องเชื่อมฐาน Demo ในเครื่องที่ทิ้งได้, `SESSION_SECRET` ต้องยาวอย่างน้อย 32 ไบต์ และ `DEMO_SEED_PASSWORD` อย่างน้อย 12 ตัวอักษร ห้ามส่ง secret เหล่านี้ในแชตหรือ commit `.env`
3. ใน pgAdmin ให้สร้างฐาน **ใหม่และว่าง** ชื่อ `fixtech_demo_v18` เปิด Query Tool ของฐานนี้ แล้วรัน `release/FixTech-demo-v1.8.database.sql` บัญชีฐานข้อมูลของแอปต้องมีสิทธิ์อ่าน/เขียนตารางที่จำเป็น ห้ามติดตั้ง DDL นี้ทับ v4, production หรือฐานที่มีข้อมูลสำคัญ
4. สั่ง `npm run setup:check -- --before-seed` เพื่อตรวจการยืนยันตัวตนกับฐานและตารางที่จำเป็น 26 ตารางโดยไม่แสดง credential ต้องแก้ทุกรายการที่รายงานก่อนทำต่อ
5. หากฐานนี้ยังไม่เคย seed ให้สั่ง seed หนึ่งครั้ง:

   ```powershell
   $env:DEMO_SEED_ALLOW_MUTATION = 'yes'
   npm run seed
   Remove-Item Env:DEMO_SEED_ALLOW_MUTATION
   ```

    seed จะใช้ `DEMO_SEED_PASSWORD` ในเครื่องกับบัญชี Demo ทุกบัญชีและไม่พิมพ์รหัสผ่านออกมา ห้าม seed ซ้ำ เว้นแต่ตั้งใจ reset ฐาน Demo ที่ทิ้งได้
6. สั่ง `npm run setup:check`, `npm run check`, `npm test` และ `python -m unittest tests/check_demo_v18_schema.py` การทดสอบ workflow ของ PostgreSQL จะถูกข้ามถ้าไม่ได้กำหนด `FIXTECH_TEST_DATABASE_URL` ให้ชี้ไปยังฐานทดสอบที่ทิ้งได้อย่างชัดเจน
7. สั่ง `npm start` และเปิดหน้าต่าง PowerShell ค้างไว้ จากนั้นเข้า `http://localhost:3000` ตรวจว่า `/api/health/ready` รายงาน `ready` ก่อน login รหัสผ่านของบัญชี Demo ทุกบัญชีเท่ากับ `DEMO_SEED_PASSWORD` ในเครื่อง

ถ้า Ollama/Gemma 3 4B ใช้งานไม่ได้ ให้ตั้ง `AI_PROVIDER=disabled` ใน `.env` แอปยังเปิดได้แต่จะวิเคราะห์ด้วย AI ไม่ได้ หากต้องการ AI ในเครื่องให้ใช้ `AI_PROVIDER=ollama` และเปิด Ollama บน loopback ราคา curated ไม่ใช่ราคาตลาดสดและการชำระเงินเป็น simulation เท่านั้น ระบบนี้เป็น Demo นักศึกษาในเครื่อง ไม่ใช่ production deployment

เมื่อต้องการตรวจ DDL กับ PostgreSQL จริงในเครื่อง ให้กำหนด `SCHEMA_TEST_DATABASE_URL` ใน `.env` ที่ Git ไม่ติดตาม โดยใช้บัญชี migration ที่สร้างฐานได้ แล้วทำตาม [คู่มือตรวจ schema บนฐานที่ทิ้งได้](release/README.md) ค่านี้แยกจาก `DATABASE_URL` ของแอป

workflow ของ Demo และเส้นทาง Ollama ในเครื่องผ่านการทดสอบขณะรันจริงกับ PostgreSQL 18.6 บนฐานที่ทิ้งได้ และชุด workflow เต็มผ่านโดยไม่ข้าม แต่ผลนี้ไม่ได้หมายความว่าพร้อม production หรือรับรองความถูกต้อง/ความปลอดภัยของ AI, payment จริง, อีเมล/SMS หรือข้อกำหนด security ทั้งหมด ดู [สถานะการตรวจรับ](docs/validation.md)

## ข้อมูลเดิม

FixTech v4 เป็นระบบบริการหน้างานคนละขอบเขต ไม่ใช่ schema ของ Demo นี้. archive เก็บเฉพาะเครื่องเดิมและไม่รวมใน repository. การติดตั้ง v1.8 เป็น fresh schema เท่านั้น; ไม่มี migration/แปลงข้อมูลจริงจาก v4.
