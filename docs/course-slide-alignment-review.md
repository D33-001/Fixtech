# Fixtech 1.0 — ความสอดคล้องกับสไลด์ CE385/CE396

**ขอบเขต:** สไลด์ CE385 สัปดาห์ 1–5 และ 8, CE396 สัปดาห์ 1–5; CE385 สัปดาห์ 4 มีไฟล์ชื่อซ้ำแบบ `(1)` จึงนับเป็นหัวข้อเดียว. เปรียบเทียบแนวคิดและเกณฑ์ในสไลด์กับเอกสาร/โค้ด Fixtech 1.0. นี่เป็นการตรวจความสอดคล้องกับ *เอกสารประกอบการเรียน* ไม่ใช่คำสั่งให้ทำ lab ตัวอย่างทุกขั้นหรือเปลี่ยนเทคโนโลยีของโครงการ. โปรเจกต์ที่ผู้ใช้ระบุว่าเป็นงานรายวิชาเดียวต้องยึดเกณฑ์ของวิชาที่ส่งจริง; ตาราง CE385/CE396 ด้านล่างแสดงความเกี่ยวข้อง ไม่สมมติว่าต้องส่งทั้งสองรายวิชา.

## 1. สิ่งที่พบและปรับ

| สไลด์ / หน้าที่ใช้อ้าง | หลักที่เกี่ยวกับ Fixtech | สถานะปัจจุบันและการปรับ |
|---|---|---|
| CE385 สัปดาห์ 1 หน้า 20–21, 25, 29 | คะแนนโครงงานเน้นสถาปัตยกรรม เหตุผลเลือกเทคโนโลยี Demo และการมีส่วนร่วมของสมาชิก; ส่ง source และ slides ตามกำหนดวิชา | เพิ่มภาพสถาปัตยกรรมกับเหตุผลเลือกใน `design.md`; เพิ่มหลักฐานการมีส่วนร่วมในขั้น 8. ยังไม่มี slide deck/หลักฐานส่ง GitHub รอบนี้ |
| CE385 สัปดาห์ 2 หน้า 20, 30–40 | Client–server, N-tier, HTTP/stateless และ session | Demo มีเว็บ → Express → PostgreSQL; session ใช้ cookie ลงลายเซ็นและตรวจ role จาก DB ทุกคำขอ. ระบุว่าระบบนี้ไม่ใช่ stateless token API แบบ lab |
| CE385 สัปดาห์ 3 หน้า 2–3, 20 | Modularity, cohesion/coupling, ES modules | แยก `src/app.js`, `src/api.js`, `src/db/pool.js`, pricing/integration modules แล้ว. `src/api.js` ยังใหญ่และรวมหลาย workflow; เป็นจุดปรับโครงสร้างในอนาคต แต่ไม่จำเป็นต้องรื้อก่อน Demo หาก tests ยังผ่าน |
| CE385 สัปดาห์ 4 หน้า 1–3 และหัวข้อ Event Loop/async | งาน I/O แบบไม่บล็อกและการจัดการ async error | PostgreSQL/ไฟล์/Ollama ใช้ async; AI วิ่งแยกจาก DB transaction ตาม `integration.md`. ไม่อ้างว่าทดสอบประสิทธิภาพภายใต้โหลด |
| CE385 สัปดาห์ 5 หน้า 10, 30, 40, 60 | Express routes, middleware, error handler, CRUD/API test | `src/app.js` มี JSON/helmet/error middleware; `src/api.js` ตรวจ session/ownership และคืน error shape กลาง. ตัวอย่าง todo CRUD ในสไลด์เป็น lab ไม่ใช่ resource ที่ Fixtech ต้องเพิ่ม |
| CE385 สัปดาห์ 8 หน้า 8, 13–23, 30–43, 90 | API contract, URL/method/status, validation สามชั้น, Prisma/PostgreSQL | ขั้น 5 มี contract และ `src/api.js` ใช้ SQL แบบ parameterized กับ DB constraints. เพิ่มหมายเหตุที่ขั้น 5 ว่า Fixtech เป็น REST-style HTTP JSON API ที่มี action routes, `400` สำหรับ body validation หลายกรณี, `201` บาง route ยังไม่มี `Location`, ยังไม่มี Zod/Prisma/OpenAPI. อย่าอ้างว่าทำครบตามตัวอย่างสัปดาห์ 8 |
| CE396 สัปดาห์ 1 หน้า 20–21, 29–30 | โครงงานอธิบาย ER/relational, normalization, PostgreSQL DDL/sample data และ business queries อย่างน้อย 5 ข้อ | มี ERD/DDL/seed และ test ฐานจริง; เพิ่มรายการเตรียม FD/normalization และ 5 queries ในขั้น 8. ยังไม่มีชุด 5 queries ที่รันรับรองสำหรับส่งรายวิชา |
| CE396 สัปดาห์ 2 หน้า 29–40 | ระดับ conceptual/logical/physical, relational model, PostgreSQL | ขั้น 2–4 แยก use case, ERD/relational และ DDL; runtime เชื่อม PostgreSQL จริงในผลตรวจรับก่อนหน้า |
| CE396 สัปดาห์ 3 หน้า 2–3, 30, 40 | Entity/attribute, cardinality/participation, associative/weak entity | ขั้น 4 มี 26 ตารางและความสัมพันธ์; เพิ่มตัวอย่างการอ่านตารางเชื่อมและ 1:1 ในหัวเอกสารขั้น 4. ต้องให้ทีมอธิบายเหตุผล cardinality จากกฎธุรกิจ ไม่ใช่อ่านตัวเลขจากภาพอย่างเดียว |
| CE396 สัปดาห์ 4 หน้า 1–3, 39–47 | แปลง ER เป็นตาราง, PK/FK/UNIQUE/CHECK/ON DELETE | DDL มีข้อจำกัดจริง; ส่วนที่กฎข้ามแถวใช้ transaction ใน API. ยังต้องเตรียมคำอธิบาย ON DELETE และกรณีละเมิด constraint สำหรับการนำเสนอ |
| CE396 สัปดาห์ 5 หน้า 2–3, 18–25, 58 | FD, candidate key, 1NF–3NF, DML/anomaly | ขั้น 4 ระบุเป้าหมาย 3NF แต่เดิมไม่มีตัวอย่าง FD ชัด; เพิ่มตัวอย่าง `districts`, `provider_districts`, `company_profiles`. ยังไม่ใช่การพิสูจน์ 3NF ทุกตาราง และยังต้องเตรียมตัวอย่าง anomaly/closure ถ้าเป็นเกณฑ์รายวิชา |

## 2. ข้อแตกต่างจากตัวอย่างสไลด์ที่ต้องอธิบายตามจริง

1. **Prisma/Zod:** CE385 สัปดาห์ 8 ใช้ TypeScript + Prisma + Zod เป็นชุดสาธิต. Fixtech ปัจจุบันเป็น JavaScript + `pg` + validation ในแอป + constraints ใน PostgreSQL. ย้าย ORM ตอนนี้จะเพิ่ม schema/migration/client อีกชุดและเสี่ยงทำ DDL 26 ตารางไม่ตรง. การใช้หลัก validation สามชั้นสำคัญกว่าการคัดลอกไลบรารีตาม lab. หากอาจารย์สั่งให้ใช้ Prisma โดยตรง ค่อยกำหนด migration และ test เป็นงานใหม่.
2. **REST และ HTTP status:** สไลด์ใช้ resource CRUD `students`; Fixtech มี action routes เพื่ออธิบายการเปลี่ยนสถานะ เช่น publish/complete. สัญญา API ปัจจุบันระบุ `400` สำหรับ validation และ `201` สำหรับสร้างหลายรายการโดยไม่ได้ตั้ง `Location` เสมอ. ไม่ควรนำกฎ `400 path/query, 422 body` ใน lab มาอ้างว่าระบบทำแล้ว. การแก้ให้เหมือนสไลด์เป็นการเปลี่ยน API contract ที่กระทบ client/tests จึงควรทำพร้อมกันเมื่อเป็นเกณฑ์ของรายวิชา.
3. **Stateless:** HTTP request เป็นอิสระ แต่ Demo ใช้ cookie session ที่ client ถือ; server อ่าน user/role จาก DB. จึงไม่ใช่ bearer token API ในตัวอย่างสัปดาห์ 8 และไม่ควรนำผลเรื่อง scale-out/token มาอ้างโดยไม่มีการทดสอบ.
4. **Normalization กับ snapshots:** ข้อมูลอ้างอิงราคาและเงื่อนไขรับประกันเก็บ snapshot เพื่อให้ตรวจย้อนหลังได้ แม้มีข้อมูลบางส่วนซ้ำ. ต้องอธิบายเหตุผลของการเก็บภาพ ณ เวลาและตรวจว่าข้อมูลหลักไม่ถูกแก้ผ่านหลายแถวแบบไม่สอดคล้อง.
5. **หลักฐานการส่งงาน:** แผนขั้น 8 ตอนแรกเน้น Demo เป็นหลัก. เกณฑ์ CE385 เพิ่ม architecture/technology rationale; CE396 เพิ่ม FD/normalization, 5 business queries, ERD ต้นฉบับ, SQL/seed และหลักฐานทุกคนมีส่วนร่วม. เพิ่มเป็นรายการเตรียมในขั้น 8 แต่ยังไม่ทำเครื่องหมายว่าผ่านจริง.

## 3. คำถามธุรกิจ 5 ข้อสำหรับฝั่ง CE396

ตัวอย่างเดินบรรทัดฐานเพื่อใช้ซ้อมอธิบาย: หากเริ่มจากข้อมูล `provider_id, provider_name, district_code, district_name` ที่มีหนึ่งแถวต่อคู่ช่าง–เขตและถือว่า `(provider_id, district_code)` เป็น candidate key จะได้ FD `provider_id → provider_name` และ `district_code → district_name`. ค่าทั้งสองขึ้นกับเพียง **ส่วนหนึ่ง** ของคีย์ผสม จึงผิด 2NF แม้ทุกช่องเป็นค่าเดี่ยวผ่าน 1NF. แยกเป็น `provider_profiles(id, display_name)`, `districts(code, name)` และ `provider_districts(provider_id, district_code)` แล้วข้อมูลชื่ออยู่กับคีย์เจ้าของ. ตัวอย่างนี้อธิบายเพียงความสัมพันธ์หนึ่งชุด; ไม่ใช่การพิสูจน์ 3NF ของทั้ง schema. สำหรับกรณี `jobs.id → district_code → districts.name` การเก็บชื่อเขตใน `jobs` ซ้ำจะเกิด transitive dependency; โครงปัจจุบันใช้ FK ไป `districts` แทน.

ไฟล์ [ชุดคำสั่ง SQL สำหรับฝึกนำเสนอ](../release/03-business-queries.sql) ตอบ:

1. แต่ละสถานะมีงานกี่งาน?
2. แต่ละเขตมีงานกี่งาน?
3. ช่างแต่ละรายได้รับงานกี่งาน?
4. แต่ละหมวด/รูปแบบบริการมีราคาเสนออ้างอิงเฉลี่ยเท่าไร?
5. งานที่มีข้อพิพาทมีจำนวนและสถานะข้อพิพาทอย่างไร?

คำสั่งเป็น `SELECT` อ่านอย่างเดียวและอิง DDL 1.0; **ยังไม่ถือว่าผ่านเกณฑ์ส่ง CE396** จนกว่าจะรันบนฐาน PostgreSQL ที่ seed แล้ว ตรวจผล/แผนภาพประกอบ และให้สมาชิกอธิบาย JOIN/GROUP BY ได้.

## 4. ผลสรุปและข้อจำกัดของรอบตรวจ

โครงหลัก Demo สอดคล้องกับเนื้อหาวิชาในระดับแนวคิด: client/server, async I/O, Express API, PostgreSQL constraints/transactions, ER → relational และการแยกตาราง. รอบนี้แก้เอกสารสถาปัตยกรรม, API, ตัวอย่าง normalization และแผนขั้น 8; เพิ่ม SQL อ่านอย่างเดียวสำหรับ 5 คำถาม. **ไม่ได้เปลี่ยนพฤติกรรมเว็บหรือฐานข้อมูล และไม่ได้เปิด Prisma/เงินจริง**. การตรวจไฟล์ PDF เป็นการใช้เนื้อหา/เกณฑ์ในสไลด์เพื่อทบทวน ไม่ใช่การรัน lab ตัวอย่างทั้งหมดหรือรับรองว่าอาจารย์จะให้คะแนนเต็ม. งานค้างที่ต้องตรวจบนเครื่องทีมคือผล SQL 5 ข้อ, OpenAPI/Swagger ถ้ารายวิชาบังคับ, slide deck, ประวัติการมีส่วนร่วม และผลสาธิตจริง.
