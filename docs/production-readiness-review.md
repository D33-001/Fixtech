# Fixtech 1.0 — ตรวจความพร้อมสำหรับระบบใช้งานจริง

**คำตัดสิน:** ขั้น 1–7 ผ่านสำหรับ ระบบสาธิต 1.0 เท่านั้น; ยังตรวจรับเป็น Production ไม่ได้

เอกสารนี้ใช้ตัดสินงานที่ขอเพิ่มหลัง Demo: ชำระเงินจริง, ราคาอ้างอิงที่อัปเดต, ยืนยันตัวตนช่าง และการตรวจหน้าเว็บครบสี่บทบาท. รายละเอียดแนวทางอยู่ใน [แผนขยาย](production-expansion-v1.md); หลักฐานเดโมอยู่ใน [validation](validation.md). ห้ามนำผลทดสอบ payment simulation หรือราคา curated ไปอ้างแทนผลเงินจริง.

| ขั้น | สิ่งที่ต้องเปลี่ยนจึงจะตรวจรับ Production ได้ | สถานะปัจจุบัน |
|---|---|---|
| 1 — Requirements | ระบุผู้รับเงินตามสัญญา, นโยบาย refund/chargeback/ค่าคอมมิชชัน, สิทธิ์ใช้ข้อมูลราคา, วิธีตรวจตัวตนและข้อมูลที่เก็บ, เป้าหมายความสดแยกรายหมวด | ยังขาดข้อตกลงผู้ให้บริการและแหล่งข้อมูล |
| 2 — Use cases | เพิ่มการเริ่มชำระ, รอผล, ชำระสำเร็จ/ล้มเหลว, refund, reconciliation; ช่างสมัคร/ส่งหลักฐาน/ถูกปฏิเสธ/หมดอายุ; ราคาไม่มีข้อมูลหรือข้อมูลเก่า | ยังไม่มี contract API จริง |
| 3 — Activity | แยกผล redirect ของลูกค้าออกจากหลักฐาน webhook/ตรวจ charge; เพิ่มเส้นทาง KYC และราคา stale; กำหนดกรณีซ้ำ/ขัดแย้ง | ยังไม่มีผัง Production ที่ตรวจรับ |
| 4 — ERD/Data Dictionary | migration แบบมีเวอร์ชันสำหรับ payment intents/events/refunds/ledger, verification cases และ price source snapshots; ระบุ key, constraints, retention และสิทธิ์ข้อมูล | เพิ่ม migration โครงข้อมูล 8 ตารางและทดสอบกับ PostgreSQL; ยังขาด ledger/settlement ตาม merchant contract, retention และ ERD รุ่น Production |
| 5 — API/state | gateway sandbox, ยอดจาก server, ตรวจ event กับ gateway, idempotency, webhook deduplication, reconciliation; กั้นช่างที่ยังไม่ verified; fail closed เมื่อราคาหมดอายุ | เพิ่ม domain rules, บริการประมวลผล event และ Opn test adapter; ยังไม่มีบัญชีทดสอบ, iApp adapter, endpoint รับ webhook, การเริ่ม charge/refund และ reconciliation; ตัวกั้น `NODE_ENV=production` ยังทำงาน |
| 6 — UI | checkout ตาม gateway, สถานะจริง, KYC consent และผลพิจารณา, แหล่ง/เวลาอัปเดตราคา; ทดสอบ B2C/B2B/ช่าง/Admin บนระบบรุ่นใหม่ | walkthrough เดิมครอบคลุม Demo เท่านั้น |
| 7 — ราคา/matching | ใช้ราคาเสนอปัจจุบันจากช่างที่ยืนยันตัวตนและ rate card ที่มีสิทธิ์ใช้; คำนวณ coverage/TTL แยกหมวดและเขต; ตรวจสูตรกับเงินจริง/ต้นทุน | เพิ่มกฎตรวจ rate card/ช่าง/อายุข้อมูลและต้องมีช่างอย่างน้อย 3 รายต่อ segment; ยังไม่มี rate card จริง, การรับรองสิทธิ์ใช้และการเชื่อมสูตรกับงานจริง |

## สิ่งที่พัฒนาและตรวจแล้ว

- [migration 0001](../release/migrations/0001_production_foundations.sql) ติดตั้งต่อจาก DDL 1.0 บน PostgreSQL 18.6 ชั่วคราวแล้ว: 26 → 34 ตาราง, บันทึกเวอร์ชันและดัชนีสำคัญครบ; [วิธีใช้](../release/migrations/README.md).
- [production policies](../src/production/policies.js) กำหนดเงินเป็นสตางค์, บริษัทต้องจ่ายผ่าน gateway, ช่างต้องมีผลตรวจไม่หมดอายุ และราคาเครือข่ายต้องมาจากช่างต่างกันอย่างน้อย 3 รายที่ให้สิทธิ์ใช้ข้อมูล.
- [payment event service](../src/production/payment-events.js) รับ webhook เป็นเพียงสัญญาณ แล้วเรียก adapter ที่ตั้งค่าฝั่ง server ไปดึง charge จริง; ตรวจ charge ID, mode, ยอด, สกุลเงิน, status และจัดการ event ซ้ำ/ลำดับผิด. ยังไม่มี endpoint ที่เปิดรับ webhook จริง.
- เพิ่ม [Opn test adapter](../src/production/opn-test-gateway.js) สำหรับสร้าง charge แบบ GrabPay และตรวจ charge ผ่าน API origin ที่กำหนดตายตัว; รับเฉพาะ test secret key และทดสอบด้วย HTTP double. ยังไม่มี merchant test account/key จึงยังไม่เคยเรียก Opn จริง; ยังไม่มี endpoint เริ่มชำระ, return UI หรือ webhook สาธารณะ.
- [identity service](../src/production/identity-service.js) กำหนดให้ Admin ตรวจผลจาก vendor ก่อนอนุมัติ; [network pricing](../src/production/network-pricing.js) อ่าน rate card ที่สดและผลตรวจช่างล่าสุด. ทั้งสองทดสอบด้วย vendor จำลองบนฐานชั่วคราว ไม่ใช่ผล iApp จริง.
- ยังไม่ได้เพิ่มช่องชำระเงินจริงหรือ KYC ใน UI เดโม และตัวเริ่มแอปยังปฏิเสธโหมด Production ตามเดิม.

## ทางเลือกที่เลือกไว้เพื่อเริ่มงานจริง

- **Payment:** พิสูจน์ Opn/Omise ใน test mode ก่อน. เริ่มจากลูกค้าจ่ายเข้าบัญชีร้านค้าที่ได้รับอนุมัติ, ไม่ออกแบบเป็น escrow เอง. Gateway ระบุ charge ที่สร้างฝั่ง server และ webhook; หลัง webhook ให้ดึง charge จาก gateway ตรวจ `id`, mode, amount, currency, status และ job ก่อนบันทึก paid. ต้องถาม Opn เรื่องรูปแบบ marketplace/การจ่ายช่างและข้อสัญญาก่อน live. เอกสาร: [charge flow](https://docs.opn.ooo/grabpay?selected_country=thailand), [webhooks](https://docs.opn.ooo/api-webhooks), [supported banks](https://docs.opn.ooo/supported-banks).
- **ตัวตนช่าง:** ทดลอง iApp eKYC ใน sandbox และให้ Admin ตัดสินอนุมัติขั้นสุดท้าย; OCR/face/liveness เป็นสัญญาณช่วยตรวจ ไม่ใช่หลักฐานว่าบุคคลผ่านการตรวจฐานรัฐ. NDID เป็นทางเลือกถ้ารูปแบบสมาชิกและค่าใช้จ่ายเหมาะ. ต้องมี privacy notice, ระยะเก็บและการลบหลักฐาน. เอกสาร: [iApp](https://iapp.co.th/products/ekyc), [NDID platform](https://ndid.co.th/en/platform-en-2/), [PDPC](https://gppc.pdpc.or.th/).
- **ราคา:** ราคาเสนอจากช่าง ณ ตอนนั้นเรียกว่า live quote ได้; ราคาตลาดรวมยังไม่มี API ที่ยืนยันสิทธิ์และ coverage สำหรับทุกงานในกรุงเทพ. ใช้ rate card จากช่างที่อนุญาตให้ใช้ข้อมูลและข้อเสนอจริงที่มีเวลา/เขต/หมวด แสดงว่าเป็นราคาเครือข่าย Fixtech; เมื่อข้อมูลไม่พอให้หยุดคำนวณอัตโนมัติ. CPI ของ [TPSO](https://index.tpso.go.th/) เป็นดัชนีตามรอบเผยแพร่ ไม่ใช่ราคาซ่อมรายนาที.

## ลำดับที่ต้องผ่านก่อนเปิดเงินจริง

1. เปิดบัญชีทดสอบและยืนยันสัญญา/รูปแบบการรับเงิน; จัดหาสิทธิ์ข้อมูลราคาและบัญชี eKYC. **ห้ามใส่ API key ในเอกสารหรือแชต**.
2. เขียน migration รุ่นใหม่และ API/test sandbox. ทุกการเปลี่ยนสถานะ paid ต้องมาจากผลที่ตรวจกลับกับ gateway; redirect ของ browser และปุ่มผู้ใช้ไม่ยืนยันเงิน.
3. เชื่อม UI และทดสอบครบสี่บทบาท รวมรายการสำเร็จ/ล้มเหลว/ซ้ำ/ย้อนลำดับ/คืนเงิน, ช่างไม่ผ่าน KYC, ราคา stale/ไม่มี coverage และการเข้าถึงข้อมูลข้ามบัญชี.
4. ทำ reconciliation กับรายงานผู้ให้บริการ, security audit, privacy review, WCAG 2.2 AA, backup/restore และตรวจรับ staging โดยผู้รับผิดชอบก่อน live.

ตัวกั้นใน `src/server.js` ป้องกันการเริ่มแอป Demo ด้วย `NODE_ENV=production` เพื่อไม่ให้ผู้ใช้เข้าใจผิดว่าระบบชำระเงินจริงได้. การเอาตัวกั้นออกทำได้หลังผ่านเกณฑ์ทั้งหมดข้างต้นและมีผลทดสอบที่บันทึกไว้.
