# Migration พื้นฐานสำหรับขยายสู่ production

ไฟล์ `0001_production_foundations.sql` เพิ่ม 8 ตารางต่อจาก schema ของ Fixtech Demo v1.8 ตารางเหล่านี้เป็นเพียง **โครงสร้างพื้นฐาน** ไม่ได้หมายความว่าให้เปิด production mode หรือรับเงินจริงได้ทันที

ให้ทดลองติดตั้งบน PostgreSQL ฐานใหม่ที่ทิ้งได้ หลังติดตั้ง `release/FixTech-demo-v1.8.database.sql` แล้วเท่านั้น:

```powershell
psql -v ON_ERROR_STOP=1 -d fixtech_prod_migration_check -f release/migrations/0001_production_foundations.sql
```

ตรวจผลด้วย `SELECT version FROM schema_migrations;` และ `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';` ค่าที่คาดหวังคือ `0001_production_foundations` และ `34` ตามลำดับ migration ทำงานใน transaction เดียวและออกแบบให้รันหนึ่งครั้ง ห้ามรันซ้ำหรือใช้กับฐานสำคัญโดยไม่มี backup และการยืนยันฐานปลายทาง ทั้งนี้ไม่มี migration จาก FixTech v4

ตารางใหม่ครอบคลุมกรณี/เหตุการณ์ตรวจตัวตน, rate card ของ provider, snapshot ราคาอ้างอิงตลาด, payment intent, webhook event, refund และประวัติ migration โดยไม่เก็บภาพบัตรประชาชน ภาพใบหน้า หมายเลขบัตร หรือ webhook payload เต็มฉบับ ส่วนตารางบัญชี settlement และ payout ยังไม่เพิ่มจนกว่าจะยืนยันสัญญากับผู้ให้บริการรับชำระเงิน

การทดสอบ integration ของบริการใหม่บังคับให้ใช้ฐานที่ทิ้งได้ชื่อ `fixtech_prod_migration_check` บน loopback ซึ่งติดตั้งทั้ง DDL หลักและ migration นี้แล้ว กำหนด `FIXTECH_PRODUCTION_TEST_DATABASE_URL` และ `FIXTECH_PRODUCTION_TEST_DATABASE_ALLOW_MUTATION=yes` เฉพาะระหว่างรันทดสอบเท่านั้น ห้ามชี้ตัวแปรเหล่านี้ไปยังฐานที่มีข้อมูลสำคัญ
