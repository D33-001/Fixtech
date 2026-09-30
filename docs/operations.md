# คู่มือดูแลและเดินระบบ — Fixtech Demo v1.8

## ฐานข้อมูล

1. สร้างฐาน PostgreSQL ว่างแยกสำหรับ Demo ห้ามใช้ฐาน production หรือฐาน FixTech v4.
2. ใช้บัญชี migration รัน `release/FixTech-demo-v1.8.database.sql` ด้วย `ON_ERROR_STOP=1` ตาม [คู่มือติดตั้ง](../release/README.md).
3. ตรวจว่า schema ติดตั้งครบ 26 ตารางและไม่มี transaction ค้าง; ถ้าคำสั่งล้มเหลว ตรวจว่า transaction rollback แล้วก่อนแก้และติดตั้งใหม่.
4. เก็บ connection string และ secrets ใน `.env` ที่ถูก ignore; ห้าม commit. สำหรับ Demo ให้ใช้เฉพาะฐาน local แบบ disposable. การใช้ role เจ้าของฐานอนุญาตได้เฉพาะเครื่องนักศึกษา/ฐานทิ้งได้เท่านั้น; ห้ามนำ credential นี้ไปใช้กับฐานร่วม, server สาธารณะ หรือ production ซึ่งต้องแยก app role แบบ least privilege.
5. seed เฉพาะผู้ใช้และข้อมูลสังเคราะห์ตาม Data Model; reset ลบเฉพาะข้อมูล Demo ไม่ลบ schema/migration.

## การเชื่อมต่อแอปและการทดสอบตั้งแต่ต้นจนจบ

เมื่อสั่ง `npm start` แอปจะอ่าน `DATABASE_URL` และ `SESSION_SECRET` ส่วน `/api/health/ready` จะตรวจทั้งการเชื่อมต่อฐานข้อมูลและตารางที่จำเป็นทั้ง 26 ตาราง จากโฟลเดอร์หลักของโครงการ ให้คัดลอก `.env.example` เป็น `.env` แล้วกำหนด `DATABASE_URL` สำหรับ PostgreSQL ในเครื่อง, `SESSION_SECRET` ที่ไม่ซ้ำและยาวอย่างน้อย 32 ไบต์ และ `DEMO_SEED_PASSWORD` ที่ยาวอย่างน้อย 12 ตัวอักษร จากนั้นสั่ง `npm run setup:check -- --before-seed` เพื่อตรวจ secret, การยืนยันตัวตนกับ PostgreSQL และ schema โดยคำสั่งจะไม่แสดงข้อมูลลับออกหน้าจอ หากเป็นฐาน Demo ใหม่ที่ยังว่าง ให้กำหนด `DEMO_SEED_ALLOW_MUTATION=yes` เฉพาะตอนสั่ง seed เท่านั้น ระบบห้าม seed เมื่อ `NODE_ENV=production`, บังคับให้ระบุรหัสผ่าน และจะไม่พิมพ์รหัสผ่านออกมา หลัง seed ให้สั่ง `npm run setup:check` อีกครั้งเพื่อยืนยันว่ามีบัญชีทดสอบครบ 8 บัญชีและ 4 บทบาท เมื่อสั่ง `npm start` แล้วต้องเปิดหน้าต่างเว็บเซิร์ฟเวอร์ค้างไว้ จากนั้นเข้า `http://localhost:3000`.

เมื่อต้องการทดสอบ workflow กับ PostgreSQL ครบทั้งกระบวนการ ให้กำหนด `FIXTECH_TEST_DATABASE_URL` ให้ชี้ไปยังฐานทดสอบที่ทิ้งได้และผ่านการ seed แล้ว กำหนด `DEMO_SEED_PASSWORD` ให้ตรงกับรหัส seed และยืนยันสิทธิ์แก้ข้อมูลด้วย `FIXTECH_TEST_DATABASE_ALLOW_MUTATION=yes` ก่อนสั่ง `npm test` การทดสอบ integration จะสร้างข้อมูลงาน ข้อเสนอ แชต การชำระเงิน รีวิว และข้อพิพาทสังเคราะห์ จึงห้ามชี้ไปยังฐานที่ใช้ร่วมกันหรือมีข้อมูลสำคัญ หากไม่กำหนด `FIXTECH_TEST_DATABASE_URL` ระบบ Node.js จะข้ามกรณีทดสอบ PostgreSQL ห้ามบันทึกตัวแปรยืนยันการแก้ข้อมูลทั้งสองตัวไว้ใน `.env`, Git หรือระบบ production และควรสั่ง `npm run check` กับ `python -m unittest tests/check_demo_v18_schema.py` เพิ่มด้วย

ตัวอย่าง PowerShell หลังตั้งค่า `.env` และติดตั้ง schema แล้ว:

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

เปลี่ยน URL ให้ตรงกับฐานที่ทิ้งได้ซึ่งติดตั้งและ seed จริง ตัวแปรที่อนุญาตให้แก้ข้อมูลต้องตั้งชั่วคราวเท่านั้น และต้องตรวจชื่อฐานปลายทางก่อนกำหนดทุกครั้ง ห้าม commit `.env` หรือใช้ข้อมูลบัญชีตัวอย่างนอกเครื่องพัฒนา ทั้งนี้ `DATABASE_URL` ของแอปจะไม่ถูกนำมาใช้เป็นฐานทดสอบ integration โดยอัตโนมัติ

## ไฟล์และระยะเวลาเก็บรักษา

ใช้ private local storage สำหรับ Demo, บังคับตรวจ MIME/signature/ขนาด/สิทธิ์, ไม่เสิร์ฟไฟล์จาก public path และลบข้อมูลทดสอบจาก active storage ภายใน 30 วันหลังประเมินตาม SRS NFR-016. ห้ามใช้ข้อมูลจริงของลูกค้าหรือเอกสารยืนยันตัวตนจริง.

## AI ในเครื่องและแหล่งราคาอ้างอิงที่คัดเลือกไว้

1. ติดตั้ง Ollama ในเครื่อง แล้วสั่ง `ollama pull gemma3:4b` และ `ollama run gemma3:4b` เพื่อตรวจว่าโมเดลทำงานได้ ให้ Ollama รับการเชื่อมต่อเฉพาะ loopback (`127.0.0.1:11434`) แอปจะไม่ยอมเริ่มหากใช้ `AI_PROVIDER=ollama` ร่วมกับ `NODE_ENV=production` เพราะตัวเชื่อมต่อนี้มีไว้สำหรับ Demo และยังไม่ใช่ระบบ AI production ที่ผ่านการอนุมัติ
2. กำหนด `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=gemma3:4b` และ `AI_TIMEOUT_MS=120000` ใน `.env` ซึ่ง Git ไม่ติดตาม หาก AI ติดต่อไม่ได้ ระบบต้องหยุดอย่างปลอดภัยและคงงานไว้ที่สถานะ Draft
3. กำหนด `MARKET_PRICE_PROVIDER=curated_demo` ราคาอ้างอิงที่คัดเลือกไว้ใช้ได้ไม่เกิน 30 วันนับจาก `reviewedAt` การตั้งค่า `MARKET_PRICE_MAX_AGE_HOURS` ของแหล่งข้อมูลสด ซึ่งมีค่าเริ่มต้น 24 ชั่วโมง ไม่ได้ยืดอายุข้อมูลชุดนี้ นักพัฒนาต้องเปิดตรวจแหล่งอ้างอิงจริงและอัปเดตวันที่ทบทวนก่อนครบ 30 วัน การอ่านข้อมูลห้ามเลื่อนวันที่ให้อัตโนมัติ ข้อมูลนี้ไม่ใช่ live API, ผลสำรวจตลาด หรือใบเสนอราคาจาก Fixtech
4. ตรวจ `/api/demo/status` แล้วทดลองวิเคราะห์หนึ่งครั้งและถาม AI ต่อหนึ่งครั้งด้วยข้อความหรือภาพสังเคราะห์ จากนั้นบันทึกเครื่อง โมเดล วันที่ และผลใน `docs/validation.md` เพราะ unit test ยืนยันได้เพียงตรรกะของโปรแกรม ไม่ได้ยืนยันว่าโมเดลพร้อมใช้งานหรือให้คำตอบมีคุณภาพ

สำหรับทดสอบหน้าจอเมื่อราคาอ้างอิงหมดอายุเท่านั้น สามารถใช้ `FIXTECH_TEST_CURATED_REVIEWED_AT` เปลี่ยนเวลาทบทวนข้อมูลได้เมื่อ `NODE_ENV=test` ห้ามตั้งตัวแปรนี้ใน development, Demo หรือ production และระบบจะไม่สนใจค่านี้นอกโหมดทดสอบ

ถ้าบริการไม่มีข้อมูลอ้างอิงที่จับคู่ได้อย่างถูกต้อง ห้ามสร้างราคาขึ้นเอง ให้คืน `ESTIMATE_UNAVAILABLE` และส่งต่อให้มนุษย์ตรวจสอบ

## ระบบเดิม v4

v4 database และวิธีสำรอง/กู้คืนเดิมถูกเก็บใน `archive/fixtech-v4/`. คำสั่ง/manifest ของ v4 ไม่ใช่ขั้นตอนของ Demo v1.8. ไม่มีการย้ายข้อมูลอัตโนมัติจาก schema v4.
