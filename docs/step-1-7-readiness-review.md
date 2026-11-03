# Fixtech 1.0 — ตรวจรับขั้น 1–7

**ขอบเขต:** ตรวจเอกสาร การเชื่อมโยง schema/API/UI การทดสอบ backend และ walkthrough บนเว็บ โดยใช้ข้อมูลสังเคราะห์และ PostgreSQL ชั่วคราวที่สร้างเพื่อการตรวจรอบนี้

## คำตัดสิน

**ขั้น 1–7 ผ่านการตรวจรับสำหรับขอบเขต Fixtech 1.0 และพร้อมใช้เป็นฐานทำขั้น 8 (แบ่งงาน 3 คน)** ตามหลักฐานที่สรุปด้านล่าง ไม่ได้หมายความว่าเป็นระบบ production หรือผ่านการรับรองความปลอดภัย/ความแม่นยำของ AI ในวงกว้าง การตั้งค่า `.env` และฐานข้อมูลถาวรของเครื่องผู้ใช้ไม่ได้ถูกแก้หรือรับรอง; การตรวจครั้งนี้ใช้ฐานชั่วคราวแยกต่างหากและปิดทิ้งหลังทดสอบ.

## สถานะตรวจรับรายขั้น

| ขั้น | สิ่งตรวจรับ | ผล | ขอบเขต/หลักฐาน |
|---|---|---|---|
| 1 — Software Requirements | บทบาท B2C/B2B/ช่าง/Admin, ขอบเขต Demo, AI consent, ราคาอ้างอิง, payment simulation, acceptance และ exclusions | **ผ่าน** | SRS ปัจจุบันเป็น authority; ข้อความ 1.0 ที่เก็บไว้ถูกทำเครื่องหมาย historical และไม่ขยายขอบเขต 1.0 |
| 2 — Use cases / API contract | บทบาท, pre/postconditions, เส้นทางหลัก, error และการเชื่อมข้อมูล | **ผ่าน** | contract ปัจจุบันเชื่อม use cases กับ API/job state/schema; การเปลี่ยนในอนาคตต้องปรับเอกสารและ tests ร่วมกัน |
| 3 — Activity diagrams | flow ลูกค้าทั่วไป/บริษัท, AI/ราคา, matching/offers, appointment, repair, aftercare/Admin | **ผ่าน** | ใช้ผังปัจจุบันและ traceability; state transitions อิง API ขั้น 5 ไม่ใช่การเปลี่ยนจาก UI เอง |
| 4 — ERD / Data Dictionary / DDL | ERD และ 26 ตาราง, keys/constraints/indexes, การติดตั้งจริง | **ผ่านในฐานทดสอบ** | PostgreSQL 18.6 ฐานว่างชั่วคราว; DDL ติดตั้งและ preflight ยืนยัน schema 26/26 และบัญชีสังเคราะห์ 8/8; ไม่ได้ติดตั้งทับฐานผู้ใช้ |
| 5 — API / Job state | HTTP-to-PostgreSQL, authorization/privacy, guards, B2C/B2B lifecycle, payment simulation, warranty/review/dispute | **ผ่าน** | `npm test`: 30/30 ผ่าน ไม่มี skip บนฐาน integration ชั่วคราว; `npm run check` และ schema tests 8/8 ผ่าน |
| 6 — Wireframe / UI | flow หลัง redesign ครบสี่บทบาท, dialogs, consent/upload, responsive, keyboard focus, browser errors | **ผ่านตามเกณฑ์ Demo ที่ทดสอบ** | browser walkthrough ผ่าน B2C, B2B, ช่าง และ Admin; ตรวจขนาด 320/768/1280px ไม่มี horizontal overflow; keyboard focus ปรากฏ; console errors ว่าง; contrast สีที่แก้ผ่านอัตราส่วน 4.5:1 สำหรับข้อความปกติในคู่สีที่ตรวจ |
| 7 — Pricing / matching | curated price freshness, B2C estimate, B2B range/offers, matching eligibility/priority | **ผ่านตามข้อกำหนด Demo** | PostgreSQL tests และ browser flow ปกติ/ข้อมูลภาพ/ราคา; แสดงแหล่งที่มาและข้อจำกัด non-live; ไม่อ้างราคา real-time หรือ weighted quality score |

## รายละเอียดการทดสอบปลายทางบนเว็บ

ใช้ synthetic accounts และฐาน UI ชั่วคราว:

- **ลูกค้าทั่วไป:** consent ก่อนส่งภาพ, อัปโหลดภาพส่วนตัว, วิเคราะห์อาการด้วย Ollama/Gemma 3 4B, แสดงราคาอ้างอิง, สร้างงานและจับคู่อัตโนมัติ; ส่งแชต/เสนอนัด; ตรวจรับงาน, simulated payment, review, warranty claim และ dispute.
- **ช่าง:** เห็นเฉพาะงานที่ได้รับมอบหมาย, ตอบแชต, ยืนยันนัด, เริ่มงาน, ส่งงานเสร็จ และเสนอประกัน.
- **Admin:** เห็นคิวข้อพิพาท/ประกัน, ดำเนินการ resolution และตรวจ notification.
- **บริษัท:** กรอกฟิลด์บริษัท, รับสรุป/ช่วงราคาโดยมี caveat, เปรียบเทียบข้อเสนอทีมช่างจำลองสองรายการ, เลือกข้อเสนอและเข้าสู่สถานะรอนัด.
- **กรณีปฏิเสธ AI consent:** ไม่อัปโหลดภาพ/ไม่เรียก AI และเสนอ manual fallback อย่างชัดเจน.
- **ขนาดจอและการเข้าถึงเบื้องต้น:** 320, 768, 1280 CSS px ไม่มี overflow; keyboard tab แสดง focus outline; คู่สีที่แก้ตรวจ contrast ผ่าน 4.5:1. นี่เป็นการตรวจรับตามขอบเขต Demo ไม่ใช่การรับรอง WCAG เต็มรูปแบบ.

การตรวจพบและแก้บั๊กจริงหนึ่งรายการ: หลัง reset ฟอร์ม ประเภทอุปกรณ์กลับเป็น Hardware แต่รูปแบบบริการค้างเป็น Online จนทำให้คู่ Hardware/Online ถูกปฏิเสธ; เพิ่มการ sync ตัวเลือกบริการเมื่อเปลี่ยนหมวด/รีเซ็ตฟอร์ม และยืนยัน flow บริษัทผ่านแล้ว. เพิ่ม integration regression สำหรับไฟล์ที่แอบอ้างเป็น PNG, ขนาดเกิน 10 MiB, เพดานสามภาพ และการดาวน์โหลดไฟล์ของบริษัทอื่น.

## ข้อจำกัดและสิ่งที่ยังไม่ใช่การตรวจรับ Production

- ราคาเป็น curated reference ไม่ใช่ราคา real-time; ความสดของราคาไม่รับประกันตลาดปัจจุบัน.
- AI local ผ่านเส้นทางเว็บและภาพตัวอย่าง แต่คุณภาพคำตอบยังคลาดเคลื่อนได้; safety fallback ตรวจเพียงรูปแบบเสี่ยงที่รู้จัก ไม่ใช่ moderation ครบถ้วน. ต้องมีคนตรวจคำแนะนำก่อนตัดสินใจซ่อม.
- การชำระเงินเป็น simulation; ไม่มี gateway, settlement/refund หรือเงินจริง.
- Email/SMS, วิดีโออัปโหลด, ยืนยันตัวตนจริง, onboarding ช่างจริง, supply coverage จริง, security audit และ production deployment อยู่นอกขอบเขต.
- ไม่ได้แก้ `.env` หรือฐาน PostgreSQL ถาวรที่ผู้ใช้มี; จะเปิด Demo บนเครื่องนั้นต้องตั้งค่าตาม [operations](operations.md) และรัน preflight ใหม่ด้วยตนเอง.
- `npm audit` เคยติดต่อ advisory endpoint ไม่ได้; สถานะช่องโหว่ dependency ยังไม่ยืนยัน.

## การเชื่อมโยงข้ามขั้น

SRS กำหนด actor/scope และ exclusions → use cases/API ระบุสิทธิ์และผลลัพธ์ → activity diagrams แสดงเส้นทาง/state → ERD/DDL เก็บข้อมูลและ constraints → API บังคับ transition/authorization → UI แสดงเฉพาะ action ที่ contract รองรับ → ขั้น 7 คำนวณราคา/จัดลำดับผู้ให้บริการภายใต้เงื่อนไขที่ระบุ. การทดสอบ integration และ browser walkthrough รอบนี้ยืนยันเส้นทางสำคัญของห่วงโซ่นี้ใน Demo; การเปลี่ยน scope, state, schema หรือ pricing policy ต้องอัปเดตทุกเอกสารและ tests ที่ได้รับผลกระทบ.

**สรุป:** พร้อมเริ่มขั้น 8. ให้ถือขั้น 1–7 ว่าตรวจรับแล้วเฉพาะขอบเขต Demo และหลักฐานรอบวันที่ระบุ; อย่านำคำว่า “ผ่าน” ไปตีความว่า production-ready.

**งานที่ขอเพิ่มหลังตรวจรับ:** ข้อกำหนดเงินจริง ราคาอ้างอิงที่ทันสมัย ตรวจตัวตนช่าง security audit และ WCAG 2.2 AA สำหรับรุ่นใช้งานจริงบันทึกใน [แผนขยายสู่ production](production-expansion-v1.md) และ SRS §14; ยังไม่ใช่ผลผ่านของขั้น 1–7 Demo.
