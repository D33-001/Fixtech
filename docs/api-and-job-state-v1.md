# Fixtech 1.0 — ขั้นตอนที่ 5: API และกฎการเปลี่ยนสถานะงาน

**สถานะเอกสาร:** API contract สำหรับ implementation ปัจจุบันของ ระบบสาธิต 1.0 และจุดอ้างอิงเชื่อมขั้น 1–4; ไม่ใช่ production API specification
**Base URL:** API ทุก route ใช้ prefix `/api` (เช่น `POST /api/jobs`)
**รูปแบบ:** JSON UTF-8; เวลา ISO 8601 และเก็บเป็น `timestamptz`; ID เป็น UUID
**ขอบเขตปัจจุบัน:** บัญชี seed สี่บทบาทและการสมัครลูกค้าทั่วไป/บริษัทเพื่อทดสอบ, ข้อมูลสังเคราะห์, payment simulation; AI ผ่าน Ollama/Gemma 3 4B แบบ local และราคาอ้างอิงคัดสรรตาม §9. ไม่ใช่ production API และไม่อ้างราคา live market.

เอกสารนี้ยึดพฤติกรรมที่ implement และทดสอบใน `src/api.js` กับ DDL จริงใน `release/FixTech-demo-v1.8.database.sql`. Wireframe ของหน้าจอผู้ใช้ที่ผูกกับ contract นี้อยู่ใน [ขั้น 6](wireframes-v1.md); หากภาพร่างไม่ตรง API/state ให้ยึด contract นี้และแก้ wireframe ก่อน implement. ถ้า API รุ่นนี้ไม่ตรงกับรายละเอียด route/field เก่าของขั้น 2 ให้ยึดเอกสารขั้น 5 สำหรับ implementation ที่มีอยู่ และเปิดรายการปรับเอกสารขั้น 2–4 ใน §8 ก่อนเพิ่ม feature ใหม่. Contract tests ด้วย doubles ไม่ถือเป็นการผ่าน runtime smoke test กับ Ollama ที่เครื่องเดโม.

## 1. เชื่อมโยงขั้น 1–4

| ขั้น | แหล่งอ้างอิงที่ใช้ | สิ่งที่ขั้น 5 นำมาต่อ |
|---|---|---|
| 1 — SRS | [SRS §1.4 และ §13.2–13.6](software-requirements-v1.md) | ขอบเขตสี่บทบาท, สอง workflow, security/privacy, AI/market gates, payment simulation, aftercare และ acceptance |
| 2 — Use Case/API | [Use Case §10.1–10.5](mvp-demo-design-v1.md) | Actors, routes ของ workflow, transaction boundaries, external-service failure behavior |
| 3 — Activity Diagram | [Activity §7.1–7.4](mvp-activity-diagrams-v1.md) | ลำดับ Draft → วิเคราะห์/ราคา → publish/matching → appointment → service → completion/aftercare |
| 4 — ERD/Data Dictionary | [Data Model §9.1–9.8](mvp-data-model-v1.md) และ DDL | jobs/status events, offers, consent/AI/price, messages/notifications, appointments, payment, warranty, reviews, disputes/audit |

กฎนี้แบ่ง `jobs.status` ออกจาก state ของข้อมูลลูก (appointment/payment/warranty/claim/dispute); การชำระ, แชต, รีวิว หรือการแนบไฟล์ไม่เปลี่ยน job status โดยตรง. ทุกการเปลี่ยน job status ต้องผ่าน route ฝั่ง server, ตรวจ actor/สถานะปัจจุบัน และเขียน `job_status_events` ใน transaction เดียวกัน.

## 2. รูปแบบ API, session และสิทธิ์

- สำเร็จคืน `{ "data": ... }`; error คืน `{ "error": { "code": "...", "message": "..." } }`. Logout และลบไฟล์สำเร็จคืน `204` ไม่มี body.
- ลูกค้าทั่วไปและบริษัทสมัครผ่าน `POST /api/auth/register` ได้เอง โดยตั้งรหัสผ่าน 12–128 ตัวอักษร; server อนุญาต role เพียง `CUSTOMER_GENERAL`/`CUSTOMER_BUSINESS`, hash รหัสผ่าน และสร้าง company profile ใน transaction เดียวกันเมื่อเป็นบริษัท ช่าง/Admin สมัครผ่าน route นี้ไม่ได้ ยังไม่มีอีเมลยืนยันหรือระบบลืมรหัสผ่าน
- Login ใช้ `POST /api/auth/login` และ session cookie `HttpOnly`, `SameSite=Strict`, หมดอายุ 8 ชั่วโมง; สมัครสำเร็จจะออก session แบบเดียวกันทันที; production เพิ่ม `Secure`. Client ห้ามส่ง `userId`, role หรือ owner มาใช้แทน session.
- API ตรวจ role และความสัมพันธ์งานซ้ำที่ server: ลูกค้าทำได้เฉพาะงานตน; ช่างทำงานได้เฉพาะงานที่มอบหมาย; Admin ใช้ได้เฉพาะ routes ที่ระบุ. งานของผู้ไม่มีสิทธิ์ตอบ `404` เพื่อลดการเปิดเผยว่ามีงานนั้นอยู่.
- ลูกค้า/ช่างไม่เห็น ID โปรไฟล์ของอีกฝ่ายใน job detail/list, chat หรือ appointment payload; offer ของบริษัทใช้ label สาธิต `ทีมช่าง 1/2`. Admin เห็นข้อมูลสำหรับหน้าที่ดูแลตาม route.
- Routes สาธารณะ: `GET /api/health/live`, `GET /api/health/ready`, `GET /api/demo/status`, `GET /api/catalog`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`. เส้นทางธุรกิจอื่นต้องมี session.
- รหัส HTTP หลัก: `200` สำเร็จทั่วไป, `201` สร้าง, `204` สำเร็จไม่มี body, `400` validation, `401` ไม่มี/หมด session, `403` role/action ไม่อนุญาต, `404` ไม่พบ/ไม่มีสิทธิ์, `409` state/unique/concurrency conflict, `413` payload ใหญ่, `502/503` external integration ล้มเหลว/ไม่พร้อม, `500` internal error.

**เทียบกับ CE385 สัปดาห์ที่ 8:** สไลด์ใช้ REST resource CRUD ของ `students` เป็นตัวอย่าง (รวม `201 Location` และแยก `400` path/query จาก `422` body). Fixtech มี resource routes ผสมกับ action routes ของ workflow เช่น `/publish`, `/complete`; จึงเรียกอย่างแม่นยำว่า **HTTP JSON API ที่ใช้แนวทาง REST** ไม่อ้างว่าตรงทุกข้อจำกัด REST. Implementation ปัจจุบันตอบ `400` สำหรับ validation หลายประเภทและ `201` สำหรับสร้างแถวโดยไม่ได้ใส่ `Location` ทุก route; ตารางด้านบนบันทึกพฤติกรรมจริง ไม่ได้อ้างว่าเหมือนตัวอย่างในสไลด์. ก่อนส่งงาน CE385 ให้สาธิตและอธิบายข้อแตกต่างนี้; ถ้าอาจารย์กำหนด `422`/`Location` หรือ OpenAPI เป็นเกณฑ์บังคับ ให้เปลี่ยน contract, route, client และ tests พร้อมกัน ไม่แก้เอกสารฝ่ายเดียว. รูป error ปัจจุบันใช้ `{error:{code,message}}` ร่วมกัน แต่ยังไม่มี `details[]` สำหรับ field errors ทุก route.

## 3. API Contract — บัญชีและงาน

| Method / Path | ผู้เรียกและ input ที่ใช้จริง | ผล/กฎสำคัญ |
|---|---|---|
| `POST /api/auth/register` | สาธารณะ; `{role,displayName,email,password,companyName?}` | `201 {user}` และ session cookie; เฉพาะ role ลูกค้า, อีเมลซ้ำ `409`, ข้อมูลผิด `400`, จำกัดจำนวนคำขอต่อ IP `429` |
| `POST /api/auth/login` | สาธารณะ; `{email,password}` | `200 {user}`; จำกัด login ล้มเหลวต่อ IP/email |
| `POST /api/auth/logout` | สาธารณะ/ผู้ใช้; ไม่มี body | `204`; ล้าง session cookie |
| `GET /api/auth/me` | ผู้ login | `200 {user:{id,email,role,displayName,providerId}}`; ไม่มี password hash |
| `GET /api/catalog` | สาธารณะ | `200 {services,districts}` จาก catalog ที่ active |
| `POST /api/jobs` | ลูกค้าทั่วไป/บริษัท; `{category,serviceFormat,districtCode,symptom}`; บริษัทส่ง `manufacturer`, `model`, `preferredTimeNote` ได้ | `201 {jobId,status:DRAFT}`; category/format ต้องเป็นคู่ที่ schema เปิดใช้; customer จาก session |
| `GET /api/jobs` | ผู้ login | เฉพาะงานของลูกค้า, งานที่มอบหมายให้ช่าง, หรือรายการ Admin; ซ่อน ID คู่กรณี |
| `GET /api/jobs/{jobId}` | owner/assigned provider/Admin | รายละเอียดตามสิทธิ์; ไม่มีข้อมูลติดต่อส่วนตัวของคู่กรณี |
| `GET /api/jobs/{jobId}/events` | owner/assigned provider/Admin | ประวัติ `from_status`, `to_status`, เวลา, role ผู้กระทำ; ไม่คืน actor UUID |
| `PATCH /api/jobs/{jobId}` | owner; DRAFT; ต้องส่งอย่างน้อยหนึ่งฟิลด์ใน `{symptom?,districtCode?,manufacturer?,model?,preferredTimeNote?}`; ฟิลด์บริษัทใช้ได้เฉพาะบัญชีบริษัท | ตรวจเขตและฟิลด์; เมื่อค่าเปลี่ยนจริงจึงถอน consent/ล้าง analysis/confirmation ที่อาจล้าสมัย; ค่าเท่าเดิมคืน `unchanged:true` โดยไม่เขียน DB; แก้ category/format ไม่ได้ |
| `POST /api/jobs/{jobId}/attachments` | owner; raw image body, `Content-Type`, `X-File-Name` | `201 {attachmentId,...}`; JPEG/PNG/WebP signature ถูกต้อง, ≤10 MiB/รูป, ≤3 รูป; เก็บ private storage |
| `GET /api/jobs/{jobId}/attachments/{attachmentId}` | owner/assigned provider; Admin เฉพาะไฟล์หลักฐานของ dispute | stream ไฟล์หลัง authorization; ไม่ออก public URL |
| `DELETE /api/jobs/{jobId}/attachments/{attachmentId}` | owner | soft-delete metadata/ลบ object; ปฏิเสธหากถูกใช้เป็นหลักฐาน |
| `POST /api/jobs/{jobId}/ai-consents` | owner; `{dataScope:{symptom:true,attachmentIds:[uuid...]}}` | บันทึก consent version/scope ก่อนวิเคราะห์; ปฏิเสธไฟล์ที่ไม่ได้แนบกับงาน |
| `POST /api/jobs/{jobId}/ai-consents/{consentId}/revoke` | owner | ถอน consent; consent ที่ถอนใช้วิเคราะห์รอบใหม่ไม่ได้ |
| `POST /api/jobs/{jobId}/analyze` | owner; DRAFT; `{}` และ consent active | เรียก Ollama local ผ่าน loopback เมื่อ `AI_PROVIDER=ollama`; บันทึก analysis run/version เมื่อ Draft/consent ยังเป็นรุ่นเดิม; เปลี่ยนระหว่างรอคืน `409`; ไม่กำหนดราคา; unavailable คืน `503`, invalid structured output คืน `502` |
| `GET /api/jobs/{jobId}/ai-chat` / `POST /api/jobs/{jobId}/ai-chat` | owner; DRAFT; POST `{question}` และ consent active | อ่าน/บันทึกคำถาม-คำตอบสูงสุด 20 รอบใน `ai_analysis_runs.result_json`; ใช้ consented symptom/attachments; ถ้า Draft/consent เปลี่ยนระหว่างรอให้ปฏิเสธคำตอบเก่า; ครบจำนวนคืน `409 AI_CHAT_LIMIT_REACHED`; provider ไม่พร้อมคืน `503`; contract test doubles ไม่ใช่ runtime proof |
| `POST /api/jobs/{jobId}/manual-summary` | owner; DRAFT; `{summary}` | ทางสำรองให้ผู้ใช้ใส่ summary เอง; **ไม่ใช่ผลจาก AI** |
| `POST /api/jobs/{jobId}/price-estimates` | owner; DRAFT; `{}` | server-side Demo rules only; ปฏิเสธ client multipliers; B2C ราคาเดียว, B2B ช่วง; บันทึก URL/review date/rule snapshot; แสดง non-live caveat; ถ้า Draft เปลี่ยนระหว่างรอ provider คืน `409 JOB_CHANGED` และไม่บันทึกผลเก่า |
| `POST /api/jobs/{jobId}/price-estimates/{estimateId}/accept` | owner; DRAFT; `{}` | ยอมรับเฉพาะ estimate ที่ยังสดและเป็นรุ่นใช้ได้; B2C บันทึก agreed amount; B2B รอ offer ที่เลือก |
| `POST /api/jobs/{jobId}/confirm-summary` | owner; DRAFT; `{}` | ยืนยัน analysis version; เป็น READY เมื่อราคาถูกยอมรับแล้ว มิฉะนั้นยัง DRAFT จนรับราคา |
| `POST /api/jobs/{jobId}/publish` | owner; READY_TO_PUBLISH; `{}` | transaction เปลี่ยนเป็น POSTED แล้วทำ matching/สร้าง offers; B2C match อัตโนมัติ, B2B ได้ offer, ไม่มีผู้ให้บริการได้ NO_PROVIDER_FOUND |
| `GET /api/jobs/{jobId}/offers` | owner บริษัท | คืน offers และ pseudonymous team label; ไม่คืนข้อมูลติดต่อ |
| `POST /api/jobs/{jobId}/offers/{offerId}/select` | owner บริษัท; WAITING_FOR_SELECTION; `{}` | เลือกได้ offer ของ job นี้เท่านั้น; agreed amount มาจาก offer ฝั่ง server; เปลี่ยนไป WAITING_FOR_APPOINTMENT |
| `POST /api/jobs/{jobId}/cancel` | owner; ก่อน IN_PROGRESS; `{reason}` | `CANCELLED`; ปิด offers/นัดหมายที่ active; หลังเริ่มงานคืน `409` |

## 4. API Contract — สื่อสาร นัดหมาย และวงจรบริการ

| Method / Path | ผู้เรียกและ input ที่ใช้จริง | ผล/กฎสำคัญ |
|---|---|---|
| `GET /api/jobs/{jobId}/messages` / `POST /api/jobs/{jobId}/messages` | owner และ assigned provider; POST `{body}` | อ่าน/ส่งข้อความหลังจับคู่; GET คืน `type: TEXT` หรือ structured `WARRANTY_TERMS`/`WARRANTY_ACCEPTED`, ไม่เปิด marker ภายในหรือ sender UUID |
| `GET /api/notifications` / `POST /api/notifications/{notificationId}/read` | เจ้าของ notification; POST `{}` | เห็น/mark-read ได้เฉพาะของตน; event key กันแจ้งซ้ำ |
| `POST /api/jobs/{jobId}/appointments` | คู่กรณี; `{startsAt,endsAt}` | สร้าง proposal; ต้องเป็นเวลาอนาคต, start < end, มี provider และ agreed amount; ปฏิเสธเวลาที่ซ้อนกับนัดยืนยันแล้ว |
| `GET /api/jobs/{jobId}/appointments` | คู่กรณี | รายการนัดพร้อม `proposed_by_role`; ไม่คืน user UUID |
| `POST /api/appointments/{appointmentId}/confirm` | อีกฝ่าย; `{}` | ผู้เสนอห้ามยืนยันซ้ำ; เมื่อสองฝ่ายยืนยันแล้วตรวจเวลาซ้อนซ้ำภายใต้ provider lock ก่อน set CONFIRMED/job SCHEDULED; collision คืน `409 APPOINTMENT_CONFLICT` |
| `POST /api/appointments/{appointmentId}/reschedule` | คู่กรณี; `{startsAt,endsAt,reason}` | ปิดนัดเดิมและสร้าง proposal ใหม่พร้อม `supersedes_id`; เมื่องาน SCHEDULED กลับไปรอ appointment |
| `POST /api/appointments/{appointmentId}/cancel` | คู่กรณี; `{reason}` | ยกเลิก appointment; ถ้างาน SCHEDULED ให้กลับ WAITING_FOR_APPOINTMENT |
| `POST /api/jobs/{jobId}/start` | assigned provider; SCHEDULED; `{}` | `IN_PROGRESS`; ต้องมี agreed amount |
| `POST /api/jobs/{jobId}/submit-completion` | assigned provider; IN_PROGRESS; `{note?}` | `WAITING_FOR_CUSTOMER_CONFIRMATION` |
| `POST /api/jobs/{jobId}/warranty-terms` | assigned provider; WAITING_FOR_CUSTOMER_CONFIRMATION; `{offered:boolean,durationDays?,scope?,exclusions?}` | เสนอว่ามี/ไม่มีรับประกัน; ถ้ามี duration 7/14/30 วัน; เก็บ terms ใน message table เป็น record ภายในและ API ส่ง structured type |
| `POST /api/jobs/{jobId}/warranty-terms/accept` | owner; `{offerId}` | ลูกค้ายืนยัน terms proposal ก่อนปิดงาน |
| `POST /api/jobs/{jobId}/confirm-completion` | owner; WAITING_FOR_CUSTOMER_CONFIRMATION; `{}` | ต้องมี warranty terms ที่ลูกค้ายืนยัน; สร้าง warranty snapshot และเปลี่ยน COMPLETED |
| `POST /api/jobs/{jobId}/payment-simulations` | owner; COMPLETED; `{method,idempotencyKey}` | amount อ่านจาก agreed amount ใน DB; บริษัทใช้ `PLATFORM_SIMULATED` เท่านั้น; ลูกค้าทั่วไปเลือก platform/direct; ไม่มีเงินจริง |
| `GET /api/jobs/{jobId}/payment-simulations` | คู่กรณี | ดูรายการของงานนั้น; ไม่ใช่หลักฐานรับเงินจากธนาคาร |
| `POST /api/payment-simulations/{paymentId}/confirm-platform` | owner; `{}` | ยืนยันรายการจำลอง; ไม่มี gateway |
| `POST /api/payment-simulations/{paymentId}/confirm-direct-received` | assigned provider; `{}` | ช่างยืนยันรับเงินตรง; เป็นคำยืนยันของช่างเท่านั้น |

## 5. API Contract — หลังงานและ Admin

| Method / Path | ผู้เรียกและ input ที่ใช้จริง | ผล/กฎสำคัญ |
|---|---|---|
| `POST /api/jobs/{jobId}/reviews` | owner; COMPLETED; `{rating:1..5,comment?}` | หนึ่ง review ต่อ job; duplicate คืน `409` |
| `POST /api/jobs/{jobId}/warranty-claims` | owner; warranty ACTIVE; `{reason}` | สร้าง ticket; ไม่คืนเงินอัตโนมัติ |
| `POST /api/jobs/{jobId}/disputes` | customer/provider ที่เกี่ยวข้อง; WAITING_FOR_CUSTOMER_CONFIRMATION หรือ COMPLETED; `{type,reason,attachmentIds?}` | เปิด dispute, บันทึกหลักฐานที่อยู่ใน job เดียวกัน, job → DISPUTED; แจ้ง Admin/คู่กรณี |
| `GET /api/jobs/{jobId}/disputes` | คู่กรณี | อ่านข้อพิพาทใน job ที่เกี่ยวข้อง |
| `GET /api/admin/disputes?status=...` | Admin | queue ข้อพิพาท |
| `POST /api/admin/disputes/{disputeId}/resolve` | Admin; `{outcome,resolution}`; outcome `RETURN_TO_CUSTOMER`, `KEEP_COMPLETED`, `CANCEL` | resolution/audit/notifications ใน transaction; CANCEL ทำได้เฉพาะงานที่ยังไม่เคย completed |
| `GET /api/admin/warranty-claims` | Admin | queue warranty claim |
| `POST /api/admin/warranty-claims/{claimId}/resolve` | Admin; `{status:RESOLVED\|REJECTED,resolution}` | ปิด ticket พร้อม audit record และ notification |

## 6. กฎเปลี่ยนสถานะ Job

การเริ่มงานและปลายทางแต่ละ workflow:

```text
DRAFT → READY_TO_PUBLISH → POSTED
 ├─ B2C: MATCHED → WAITING_FOR_APPOINTMENT
 ├─ B2B: WAITING_FOR_SELECTION → ASSIGNED → WAITING_FOR_APPOINTMENT
 └─ ไม่มี provider ที่เข้าเกณฑ์: NO_PROVIDER_FOUND
WAITING_FOR_APPOINTMENT → SCHEDULED → IN_PROGRESS
 → WAITING_FOR_CUSTOMER_CONFIRMATION → COMPLETED
```

| จาก | ไปได้ | Trigger/guard ที่บังคับ |
|---|---|---|
| `DRAFT` | `READY_TO_PUBLISH`, `CANCELLED` | Summary/analyzed version ผ่าน; ต้องมี estimate สดที่ลูกค้ายอมรับก่อนพร้อมเผยแพร่; ลูกค้าเท่านั้นยกเลิก |
| `READY_TO_PUBLISH` | `POSTED`, `CANCELLED` | owner publish; ตรวจ summary/version และ accepted estimate ยังสดใน transaction |
| `POSTED` | `MATCHED`, `WAITING_FOR_SELECTION`, `NO_PROVIDER_FOUND`, `CANCELLED` | B2C เลือก provider ที่ผ่าน service/area/available filters; B2B สร้าง offers ตาม provider; ถ้าจำนวน provider ไม่พอให้ NO_PROVIDER_FOUND |
| `MATCHED` | `WAITING_FOR_APPOINTMENT`, `CANCELLED` | provider ถูกกำหนด; B2C ในปัจจุบันบันทึก MATCHED แล้วต่อ WAITING_FOR_APPOINTMENT ใน publish transaction เดียวกัน |
| `WAITING_FOR_SELECTION` | `ASSIGNED`, `NO_PROVIDER_FOUND`, `CANCELLED` | บริษัทเลือก available offer ของ job เดียวกัน; server บันทึก amount/provider; จากนั้นต่อ WAITING_FOR_APPOINTMENT ใน transaction เดียวกัน |
| `ASSIGNED` | `WAITING_FOR_APPOINTMENT`, `CANCELLED` | มี provider/offer ที่เลือกแล้ว; ปัจจุบันเป็นสถานะย่อยระหว่างการเลือกกับรอนัด |
| `NO_PROVIDER_FOUND` | `CANCELLED` | ลูกค้ายกเลิก; ยังไม่มี action retry/rematch ใน API รุ่นนี้ |
| `WAITING_FOR_APPOINTMENT` | `SCHEDULED`, `CANCELLED` | นัดเดียวกันได้รับการยืนยันจากคนละฝ่ายครบสองคน, ไม่มีเวลาชน, agreed amount มีค่า; ถ้ายกเลิกงานให้ยกเลิก appointment active |
| `SCHEDULED` | `IN_PROGRESS`, `WAITING_FOR_APPOINTMENT`, `CANCELLED` | ช่าง assigned เริ่มงาน; cancel/reschedule นัดก่อนเริ่มจะย้อนกลับรอนัด; ลูกค้ายกเลิกได้ก่อนเริ่ม |
| `IN_PROGRESS` | `WAITING_FOR_CUSTOMER_CONFIRMATION` | provider assigned ส่ง completion note ได้; ลูกค้าหรือ provider เปิด dispute จากสถานะนี้ไม่ได้จนช่างส่งงาน |
| `WAITING_FOR_CUSTOMER_CONFIRMATION` | `COMPLETED`, `DISPUTED` | ลูกค้ายืนยันหลังรับ warranty terms; ลูกค้าหรือช่างที่ผูกกับงานเปิด dispute ได้ |
| `COMPLETED` | `DISPUTED` | คู่กรณีเปิดข้อพิพาทหลังงานได้; review/payment/warranty claim ไม่เปลี่ยน Job status |
| `DISPUTED` | `WAITING_FOR_CUSTOMER_CONFIRMATION`, `COMPLETED`, `CANCELLED` | ถ้า `completed_at` ว่าง: RETURN_TO_CUSTOMER หรือ CANCEL; ถ้ามีค่า: KEEP_COMPLETED เท่านั้น; ทุกผลเขียน audit และ status event |
| `CANCELLED` | ไม่มี | terminal state |

สถานะต้นทางต้องอยู่ใน map กลาง `JOB_TRANSITIONS` ใน `src/api.js`; `statusEvent()` ปฏิเสธคู่ from/to ที่ไม่ได้อนุญาตด้วย `409 INVALID_STATE_TRANSITION`. การ update Job และ insert event อยู่ใน transaction; หาก event/constraint ล้มเหลวให้ rollback ทั้งรายการ. สร้าง job ใหม่บันทึก initial event `NULL → DRAFT`.

### 6.1 State ของข้อมูลอื่น (ไม่ใช่ Job status)

| Entity | สถานะ/กติกา |
|---|---|
| Offer | `AVAILABLE → SELECTED` หนึ่งรายการต่อ job; ที่เหลือ `NOT_SELECTED`; unique/partial unique constraint กันเลือกซ้ำ |
| Attachment | `ACTIVE → DELETED`; หลักฐาน dispute ที่ยังอ้างอยู่ลบไม่ได้ |
| AI consent | active จน `revoked_at`; input เปลี่ยนแล้ว consent เดิมถูกถอน |
| AI run | `SUCCEEDED`, `FAILED`, `INVALID_RESPONSE`; analysis/version ผูกกับ job/consent; external call ต้องอยู่นอก DB transaction |
| Price estimate | `ESTIMATED → ACCEPTED` หรือ `STALE/UNAVAILABLE/SUPERSEDED`; ยอมรับได้เมื่อ curated reference ยังอยู่ในอายุทบทวน 30 วัน (หรือ live source ในอนาคตผ่าน freshness policy แยก); หนึ่ง accepted ต่อ job |
| Appointment | `PROPOSED → CONFIRMED` หลังยืนยันสองฝ่าย, หรือ `CANCELLED`; reschedule ปิด record เดิมแล้วสร้าง proposal ใหม่พร้อม supersedes link; `RESCHEDULE_REQUESTED` มีใน schema แต่ implementation ปัจจุบันไม่ได้ตั้งค่านั้น |
| Payment simulation | `PENDING → PLATFORM_SIMULATED_PAID` หรือ `PROVIDER_CONFIRMED_DIRECT`; unique idempotency key; `FAILED` เป็น schema state แต่ route ปัจจุบันไม่ได้สร้าง |
| Warranty | เมื่อยืนยันงาน: `ACTIVE` หรือ `NOT_APPLICABLE`; expiry ไม่ได้เปลี่ยนสถานะอัตโนมัติใน API ปัจจุบัน |
| Warranty claim | `OPEN/UNDER_REVIEW → RESOLVED/REJECTED` ผ่าน Admin; schema รองรับ `CLOSED` แต่ Admin route ยังไม่รับค่านั้น |
| Review | หนึ่ง record ต่อ job; schema มี visibility boolean แต่ route moderation/Admin ซ่อน review ยังไม่ implement |
| Dispute | เปิด `OPEN`; Admin resolve เป็น `RESOLVED`; schema มี intermediate/terminal statuses เพิ่มแต่ route ปัจจุบันไม่ expose การเปลี่ยนเป็น UNDER_REVIEW/REJECTED/CLOSED |

## 7. ธุรกรรม, concurrency, idempotency และความล้มเหลว

1. ใช้ `SELECT ... FOR UPDATE` กับ Job/appointment/offer/payment ที่เปลี่ยน state; เขียน entity + status event + audit/notification ที่ต้องสอดคล้องกันภายใน transaction เดียว.
2. Payment ใช้ unique `idempotency_key`; retry ภายในงานเดิมโดย user/method เดิมคืนรายการเดิม; reuse key ข้ามงาน/ผู้ใช้/วิธีชำระคืน `409`.
3. Appointment ตรวจเวลาชนทั้งตอนสร้าง proposal และอีกครั้งตอนการยืนยันครบสองฝ่าย; lock provider ก่อนตรวจช่วงเวลาที่ยืนยันแล้ว เพื่อกัน proposal ที่แข่งขันกัน confirm ทับช่วงเวลา.
4. External AI/market call ห้ามค้าง DB transaction; อ่าน Job row version ก่อนเรียก provider แล้ว lock/เทียบอีกครั้งใน transaction ก่อนบันทึก. สำหรับ AI ให้ตรวจ consent เดิมยัง active; ถ้า Draft ถูกแก้ระหว่างรอ ให้ `409 JOB_CHANGED` โดยไม่เก็บ analysis/estimate ของข้อมูลเก่า. เมื่อไม่มี provider, response ไม่ผ่าน schema, ข้อมูลตลาด stale หรือ pricing rules ผิด ให้หยุด workflow และไม่ publish ด้วยราคาปลอม. ทดสอบภายในใช้ injected test doubles และต้องแยกป้ายจาก live source.
5. Notification ใช้ unique `(user_id,event_key)` กันเหตุการณ์ซ้ำ และบันทึกใน transaction เดียวกับ domain event. ถ้า DB ปฏิเสธ notification ทั้ง transaction rollback; นี่เป็นพฤติกรรมที่เลือกให้ตรงกับ schema 26 ตาราง ไม่ใช่ post-commit best effort. External email/SMS และ durable outbox อยู่นอก Demo.
6. ข้อพิพาท Admin resolution ต้องบันทึก outcome, reason, ก่อน/หลัง state, actor และเวลาใน audit พร้อมแจ้งคู่กรณี.

## 8. Traceability, discrepancies และ validation

| Requirement/process | API/state | Activity Diagram | ERD/DDL | Test evidence |
|---|---|---|---|---|
| Intake/consent/file/AI/price | §3; DRAFT/READY guards | Step 3 §7.1 | `jobs`, `job_attachments`, `ai_consents`, `ai_analysis_runs`, `price_estimates`, `pricing_rule_sets` | PostgreSQL E2E with injected providers, race guard for edited Drafts and a separate local Ollama + HTTP/PostgreSQL smoke path passed in [validation](validation.md); authenticated browser walkthrough after UI redesign covered four roles; image quality is not certified |
| B2C auto match / B2B offer | §3; POSTED branching | Step 3 §7.1 | `provider_*`, `offers`, `jobs`, `job_status_events` | E2E general + company offer paths |
| Chat/notification/appointment | §4; schedule/collision states | Step 3 §7.2–7.3 | `job_messages`, `notifications`, `appointments` | E2E chat/appointment; overlap-confirm collision must return 409 |
| Completion/payment/aftercare | §4–5 | Step 3 §7.2–7.3 | `payment_simulations`, `warranties`, `warranty_claims`, `reviews` | E2E payment retry, cross-job idempotency rejection, B2B payment restriction, warranty/review/claim |
| Dispute/Admin/audit | §5–6 | Step 3 §7.2–7.4 | `disputes`, `dispute_evidence`, `admin_audit_logs` | E2E dispute resolution/evidence; rejects returning an already completed job to customer confirmation |

**จุดเชื่อขั้น 2–4:** Step 2 §10.2 ตอนนี้อ้างอิง inventory ขั้น 5 และระบุ transport/chat paging ที่ implement จริง. Step 3 §7.3 แสดง `SCHEDULED → WAITING_FOR_APPOINTMENT` เมื่อเลื่อน/ยกเลิกนัด; B2C publish ผ่าน `POSTED → MATCHED → WAITING_FOR_APPOINTMENT`, B2B ผ่าน `POSTED → WAITING_FOR_SELECTION → ASSIGNED → WAITING_FOR_APPOINTMENT`. `DISPUTED` resolution มี guard จาก `completed_at` ตามตาราง §6 และแผนภาพขั้น 3. บาง enum ใน DDL เช่น `RESCHEDULE_REQUESTED`/สถานะปลายทาง dispute ยังไม่มี route transition; ห้ามถือว่าใช้งานได้. คง 26-table contract ของ Step 4; ขั้น 5 ไม่เพิ่ม schema. ผลติดตั้ง/ทดสอบ PostgreSQL ล่าสุดอยู่ใน [validation.md](validation.md).

ข้อสรุปการเชื่อมขั้น: SRS กำหนด scope/acceptance; Step 2 ระบุ actors/use cases; Step 3 แสดงลำดับกิจกรรม; Step 4 บังคับ foreign keys, checks, unique constraints และ event storage; Step 5 ผูกทั้งหมดเป็น API/guard/transition/test ที่ implement ได้. การปรับ adapter/pricing ใน §9 ไม่เปลี่ยน 26-table schema หรือ core workflow. ต้องผ่าน runtime smoke test กับ Ollama ก่อนอ้างว่าผ่าน AI runtime; curated price examples ไม่ใช่ข้อมูลตลาดสด.

## 9. คำตัดสิน Integration และราคา — ระบบสาธิต 1.0

> **ผลขั้น 7:** สูตร/validation/freshness และ deterministic matching implement ตาม [เอกสารขั้น 7](step-7-pricing-matching-decisions.md) แล้ว. PostgreSQL disposable workflow ผ่าน 30/30 ไม่มี skip ในรอบตรวจล่าสุด; browser ยืนยันทั้งหน้าราคาปกติและ stale-reference error ตาม validation report.

ส่วนนี้แทนข้อความก่อนหน้าในเอกสารขั้น 1–5 ที่กำหนดให้ใช้ external AI และ live-market API สำหรับ Demo; ไม่แก้ requirement ของบริการ production.

- **AI:** runtime adapter `AI_PROVIDER=ollama`, default `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=gemma3:4b`. อนุญาตเฉพาะ loopback URL, มี request timeout, ส่งเฉพาะข้อความ/ภาพที่ consent ครอบคลุม และตรวจ JSON schema; text PII redaction เป็น best effort เท่านั้น ไม่รับประกันลบครบ. มี narrow post-check สำหรับ pattern คำแนะนำเสี่ยงที่รู้จัก; ไม่ใช่ safety moderation ที่ครอบคลุม. Factory ปฏิเสธ Ollama เมื่อ `NODE_ENV=production`; local model ไม่ใช่ production AI. แอปผ่าน smoke test สำหรับข้อความ ภาพ แชต และราคา curated บนฐานชั่วคราว แต่ยังไม่รับรองคุณภาพ output และต้องใช้ข้อมูลสังเคราะห์เท่านั้น
- **ราคา:** `MARKET_PRICE_PROVIDER=curated_demo` ใช้ตัวอย่างราคาบริการที่ตรวจจากแหล่งสาธารณะพร้อม URL/วันทบทวนใน `src/integrations/demo-price-reference.js`. ช่วงปัจจุบันคือ remote software 300–2,500 บาทและ Hardware 500–800 บาท ซึ่งครอบคลุมระดับ/ผู้ให้บริการต่างกัน ไม่ใช่งานเทียบเคียงหรือ quote ของ Fixtech. Response ระบุ `referenceType=CURATED_PUBLIC_EXAMPLES`, `freshness=CURATED`, วันทบทวน และ source URLs; ไม่มี mapping ให้คืน `ESTIMATE_UNAVAILABLE`.
- **สูตรราคาใน implementation:** อ้างอิง low/high จาก `CURATED_PUBLIC_EXAMPLES`, ไม่ใช่ live price. `round10((laborBase + referenceEndpoint × marketShare) × districtFactor × (1 + platformMarkupRate))`; ปัดใกล้สุดทีละ 10 บาท, ขั้นต่ำ 1 บาท. Active seed rules version 3: labor ฿180 SOFTWARE/ONLINE, ฿300 HARDWARE/ONSITE; `marketShare=0.7`; เขต BANG_NA=1, PATHUM_WAN=1.1, CHATUCHAK=1.05; markup สมมติ `0.15`; complexity/urgency multiplier คง 1.0. API รับ `{}` เท่านั้นและปฏิเสธ client fields ที่พยายามเปลี่ยนราคา. B2C ราคาเดียวจาก low endpoint; B2B คำนวณช่วง low/high. ไม่มีอัตราคอมมิชชัน ภาษี หรืออะไหล่ในสูตร; AI ไม่ตั้งราคา; references เป็นตัวอย่างต่างระดับไม่ใช่ quote เทียบงานตรงกัน. รายละเอียด/test vectors อยู่ใน [บันทึกขั้น 7](step-7-pricing-matching-decisions.md).
- **Matching baseline ใน implementation ปัจจุบัน:** eligibility hard filters คือ provider approved + available + ตรง `category/service_format` และ `district_code`; เรียง `priority ASC, provider_id ASC`. B2C เลือกอันดับแรก; B2B ต้องมีอย่างน้อย 2 รายและสร้าง offers สาธิตให้สองอันดับแรก โดยยอดเป็น `estimated_min` และ `estimated_max` ตามลำดับ ไม่ใช่ quote จริงจากช่าง. `priority` เป็นลำดับ seed ไม่ใช่คะแนนผลงาน.
- **Matching ขั้น 7:** hard filters (approved, available, service pair, district), sort `priority ASC, provider_id ASC`; B2C ใช้อันดับแรก, B2B ต้องมีอย่างน้อย 2 ราย. `priority` เป็น seed order ไม่ใช่คะแนนผลงาน; ไม่มี weighted score. Curated references หมดอายุหลัง 30 วันจาก `reviewedAt`; live source ใช้ default 24 ชั่วโมงจาก `sourceUpdatedAt`. ไม่มี canonical provider rating/experience/GPS-distance/workload/response-time; ห้ามนำ raw demo reviews มาอ้างเป็นคะแนนคุณภาพ. ปัจจัยใหม่ต้องผ่าน scope/schema/API change.
- **คงนอก scope:** ไม่มีเงินจริง/payment gateway, email/SMS, video, สมัครช่างหรือยืนยันเอกสารจริง. คง in-app notification, รูป private, synthetic accounts และ payment simulation.
- **หลักฐาน readiness:** contract tests ใช้ doubles แต่ runtime smoke และ HTTP/PostgreSQL path ของ Demo ผ่านตาม [validation](validation.md). `npm test` จะรัน mutating PostgreSQL workflow ก็ต่อเมื่อกำหนดทั้ง `FIXTECH_TEST_DATABASE_URL` และ `FIXTECH_TEST_DATABASE_ALLOW_MUTATION=yes`; ใช้เฉพาะฐานทดสอบที่ทิ้งได้. `npm run seed` ต้องมี `DEMO_SEED_ALLOW_MUTATION=yes` และถูกปิดใน production. ผล smoke/acceptance ไม่ใช่การรับรองความปลอดภัยหรือคุณภาพ production.
