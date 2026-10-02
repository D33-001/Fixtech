# ติดตั้ง Fixtech 1.0

ไฟล์ `FixTech-demo-v1.8.database.sql` สร้าง schema ระบบสาธิต 1.0 บน **ฐานข้อมูลว่างเท่านั้น** และทำงานใน transaction เดียว. ไฟล์นี้ไม่ใช่ migration จาก FixTech v4; อย่ารันกับฐาน v4 หรือฐานที่มีข้อมูลซึ่งต้องเก็บ.

Schema ไม่มีการสร้าง UUID ด้วย database extension; ให้แอปสร้าง UUID ตาม Data Model. ไม่ต้องติดตั้ง extensions.

ตัวอย่าง PowerShell โดยแทนชื่อฐานและผู้ใช้ให้ตรงสภาพแวดล้อม:

```powershell
psql -X -v ON_ERROR_STOP=1 -d fixtech_demo_v18 -f release/FixTech-demo-v1.8.database.sql
```

ใช้บัญชี migration ที่มีสิทธิ์ DDL. อย่าใช้บัญชีฐานข้อมูลเจ้าของ schema เป็น credential ของเว็บ. ก่อนเปิดให้ backend ต่อฐาน ต้องกำหนด role/privilege ให้ least privilege และทำ authorization ใน server ตาม SRS; การสร้างบทบาทและ RLS ของ FixTech v4 ไม่ได้ใช้กับ schema นี้.

## ตรวจติดตั้ง DDL บน PostgreSQL จริง

จาก root ของโปรเจกต์ ให้เพิ่ม `SCHEMA_TEST_DATABASE_URL` ในไฟล์ `.env` (แยกจาก `DATABASE_URL` ของแอป) เป็น connection ของบัญชี migration ที่ต่อฐาน maintenance (เช่น `postgres`) และมีสิทธิ์ `CREATEDB`. อย่า commit `.env`. คำสั่งต่อไปนี้สร้างฐานสุ่มชื่อเฉพาะเพื่อทดสอบ ติดตั้ง DDL ตรวจ catalog/rollback แล้วลบเฉพาะฐานชั่วคราวที่สคริปต์สร้างเอง:

```powershell
$env:FIXTECH_SCHEMA_TEST_ALLOW_CREATE = 'yes'
npm run db:verify
Remove-Item Env:FIXTECH_SCHEMA_TEST_ALLOW_CREATE
```

สคริปต์จะไม่ใช้ `DATABASE_URL` ของแอปเป็นเป้าหมายติดตั้งและไม่ลบฐานนั้น; มันสร้างฐานทดสอบใหม่แยกต่างหาก. หากการติดตั้ง/ตรวจล้มเหลว จะรายงาน failure และพยายามลบฐานทดสอบชั่วคราว. ถ้าลบไม่สำเร็จ ให้ใช้ชื่อที่รายงานเพื่อตรวจและลบด้วยมือหลังยืนยันว่าเป็นฐานชั่วคราวนั้นจริง. ห้ามใส่ connection string หรือรหัสผ่านลง source control/ส่งในแชต.

การตรวจนี้ยืนยันการ parse/ติดตั้งและจำนวนตาราง, columns, PK, FK, UNIQUE, CHECK, indexes รวมทั้ง rollback probe; ยังไม่แทนการตรวจเทียบทุก column/constraint กับ Data Dictionary หรือ acceptance ของ workflow. ห้ามใช้ข้อมูลบุคคลจริง.
