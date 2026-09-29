# Fixtech Demo v1.8 — ขั้นตอนที่ 7: คำตัดสินตั้งต้นด้านราคาและ Matching

> **สถานะ:** คำตัดสินและ implementation ของ Demo ขั้น 7. นี่ไม่ใช่การรับรองราคาเชิงพาณิชย์หรือคุณภาพช่างจริง. ผลทดสอบโค้ดอยู่ในบันทึก validation; การทำงานกับฐานข้อมูลต้องใช้ seed version 3.

เอกสารนี้ยึดขอบเขต SRS §13.7, API/Job State ขั้น 5 §9 และ Wireframe ขั้น 6 §7. Demo ใช้ข้อมูลสังเคราะห์, provider seed และ curated public price examples; รายละเอียด production ใน FR-041/FR-053 เป็นเป้าหมายผลิตภัณฑ์ ไม่ใช่สิ่งที่ตัวเลข demo พิสูจน์แล้ว.

## 1. คำตัดสิน

| ประเด็น | คำตัดสินสำหรับ Demo | เหตุผล/ขอบเขต |
|---|---|---|
| `profitMargin` 15% | ตีความเป็น **platform markup rate เพื่อการสาธิต** บน subtotal ที่สูตรคำนวณ ไม่ใช่กำไรสุทธิของ Fixtech, ไม่ใช่กำไรของช่าง และไม่ใช่ค่าคอมมิชชันที่ตกลงกับผู้ให้บริการจริง | สูตรใช้ `(1 + rate)` จึงเป็น markup บนต้นทุน/ฐาน ไม่ใช่ gross margin ของราคาขาย. ไม่มีต้นทุนจริง/ยอดจ่ายช่าง/สัญญาค่าคอมมิชชันให้คำนวณกำไรจริง. ชื่อ configuration ควรเปลี่ยนจาก `profitMargin` เป็น `platformMarkupRate` เมื่อแก้ implementation; ค่า 0.15 เป็นสมมติฐาน seed สำหรับ Demo เท่านั้น. ห้ามเรียกว่า “กำไรสมเหตุสมผลจากตลาด”. |
| `complexityFactor` ที่ไม่ถูกใช้ | เอา `complexityFactor` ที่ซ้ำซ้อนออกจาก active ruleset; ใน Demo ให้ `complexityMultiplier = 1.0` คงที่ เพราะไม่มี rubric/ข้อมูลที่ตรวจสอบได้ให้จัดระดับความซับซ้อน | หน้าเว็บปัจจุบันไม่ถาม complexity; ปล่อยให้ client ส่ง multiplier เองทำให้ราคาเปลี่ยนโดยไม่มีคำอธิบาย. AI ไม่กำหนดราคา/ความซับซ้อน. ถ้าจะเปิดระดับความซับซ้อนในอนาคต ต้องนิยามคำถาม/เกณฑ์ที่ตรวจซ้ำได้และแสดงผลก่อนยอมรับราคา. |
| Urgency | ใช้ `STANDARD` และ multiplier `1.0` คงที่ใน workflow UI ของ Demo; ไม่คิด surcharge เร่งด่วน | UI ปัจจุบันไม่มีการเลือก urgency และไม่มีเงื่อนไข SLA/ช่างพร้อมรับงานเร่งด่วน. API ที่รับ `URGENT` อยู่ใน implementation ปัจจุบันแต่ยังไม่มี UX/acceptance รองรับ; ควรปิดรับค่า non-standard จนกว่าจะมี requirement/หน้าจอ/การทดสอบชัดเจน. |
| อายุ curated reference | ถือว่าราคาอ้างอิงใช้ได้ **30 วันนับจาก `reviewedAt`** ใน Demo; ใช้ 30 วันเป็น review interval เชิงปฏิบัติการ ไม่ใช่คำกล่าวอ้างว่าตลาดคงที่ 30 วัน. เมื่อครบกำหนดต้องทบทวน URL/ขอบเขต/ตัวเลขโดยมนุษย์และบันทึกวันใหม่ มิฉะนั้นปฏิเสธ estimate ว่า stale | `fetchedAt` คือเวลาที่ระบบอ่าน catalog ไม่ใช่เวลาที่ source ถูกทบทวน. ค่าปัจจุบัน 24 ชั่วโมงสั้นเกินความหมายของ manual curated source และทำให้เดโมหมดอายุวันถัดไป; ห้ามแก้ด้วยการตั้ง `sourceUpdatedAt=now()` ทุก request. ทุกหน้าต้องบอกวันทบทวนและ non-live caveat.
| Weighted matching score | **ไม่ใช้ weighted score ใน Demo.** ใช้ eligibility hard filters แล้วเรียงลำดับ deterministic ด้วย `priority ASC, provider_id ASC`; `priority` เป็นลำดับ fixture/seed เท่านั้น ไม่ใช่คะแนนคุณภาพ | ผู้ให้บริการ Demo ไม่มีข้อมูลประสบการณ์, พิกัด/ระยะทาง, response time หรือ workload. ตาราง reviews มีคะแนนรายงานต่อ job แต่ยังไม่มี aggregate/reliability policy และข้อมูลเป็น synthetic; ไม่เหมาะนำมาถ่วงคะแนน. คะแนนคณิตศาสตร์ที่สร้างจากตัวแปรคงที่ใน candidate set จะให้ภาพลวงว่าแม่นยำโดยไม่มีผลแยกผู้สมัคร. |

## 2. สูตรราคาสำหรับ Demo ที่เลือก

ให้ `R` เป็น low หรือ high ของ reference ที่ตรง service pair, `L` เป็นค่าแรงฐาน seed, `M=0.70` เป็นสัดส่วนอ้างอิง, `D` เป็นตัวคูณเขต และ `P=0.15` เป็น platform markup สมมติ:

```text
subtotal = (L + R × M) × D
estimate = round_to_nearest_10(subtotal × (1 + P))
complexityMultiplier = 1.0
urgencyMultiplier = 1.0
```

ค่าตั้งต้น seed version 2: `L=180` บาทสำหรับ SOFTWARE/ONLINE, `L=300` บาทสำหรับ HARDWARE/ONSITE; `D=1.00` (BANG_NA), `1.10` (PATHUM_WAN), `1.05` (CHATUCHAK). การปัดใช้กฎเดิมใน API คือ `Math.max(1, Math.round(value / 10) * 10)`.

ตัวอย่าง reproducible ที่ BANG_NA:

| Workflow | Reference | คำนวณ | Demo estimate |
|---|---:|---|---:|
| B2C SOFTWARE/ONLINE | low ฿300 | `(180 + 300×0.70)×1.00×1.15 = 448.5` | ฿450 ราคาเดียว |
| B2B SOFTWARE/ONLINE | low ฿300 / high ฿2,500 | low = ฿448.5; high = `(180 + 2,500×0.70)×1.00×1.15 = 2,219.5` | ฿450–฿2,220 |
| B2C HARDWARE/ONSITE | low ฿500 | `(300 + 500×0.70)×1.00×1.15 = 747.5` | ฿750 ราคาเดียว |
| B2B HARDWARE/ONSITE | low ฿500 / high ฿800 | low = ฿747.5; high = `(300 + 800×0.70)×1.00×1.15 = 989` | ฿750–฿990 |

การประมาณนี้เป็นการสาธิตการคำนวณจากตัวอย่างราคาต่างระดับ ไม่ได้ยืนยันว่าเป็นราคาที่เหมาะกับอาการนั้น, กำไรจริง, ราคาตลาดปัจจุบัน, ค่าอะไหล่ หรือข้อเสนอจริงจากช่าง. B2B offers ใน Demo ยังคงเป็นข้อเสนอจำลองที่ใช้ปลายช่วงตาม API ขั้น 5 ไม่ใช่คำเสนอราคาจาก provider.

## 3. กฎคัดกรองและจัดลำดับผู้ให้บริการ

### 3.1 Hard eligibility filters

ผู้สมัครต้องผ่านทุกข้อก่อนเข้าลำดับ:

1. `is_approved = true` และ `is_available = true`.
2. มีคู่ `category + service_format` ตรงกับงานใน `provider_services`.
3. ครอบคลุมเขต `district_code` ของงานใน `provider_districts`.

ผู้ไม่ผ่านข้อใดข้อหนึ่งถูกตัดออก ไม่ได้รับ score. ไม่มีผู้ผ่าน: `NO_PROVIDER_FOUND`; ห้ามลดเกณฑ์อัตโนมัติหรือสร้างผู้สมัครสมมติ.

### 3.2 ลำดับใน Demo (แทน weighted score)

เรียง candidate ที่ผ่าน eligibility ด้วย `provider_profiles.priority ASC`, tie-break ด้วย `provider_profiles.id ASC`.

- B2C: มอบหมายอันดับแรกหนึ่งรายโดยอัตโนมัติ.
- B2B: ต้องมี candidate อย่างน้อยสองราย; สร้างสอง offers จำลองจากอันดับ 1 และ 2. ยอด offer เป็น estimate low/high ตามที่ implementation กำหนด ไม่ใช่ราคาที่ candidate แต่ละคนคำนวณ.
- Seed priorities เช่น 10/20 เป็นข้อมูลจัดลำดับสำหรับการสาธิตเท่านั้น. UI ห้ามแสดงเป็น “คะแนนความเหมาะสม”, “ความน่าเชื่อถือ” หรือการจัดอันดับคุณภาพ.

### 3.3 ขอบเขต weighted score

การตัดสินปัจจุบันคือไม่คำนวณ weighted score ใน Demo. หากผลิตภัณฑ์อนาคตต้องใช้คะแนน ต้องผ่าน change request ก่อนเพิ่ม factor และต้องมีแหล่งข้อมูลที่ตรวจได้, นิยาม normalize/weight, missing-data rule, minimum sample/privacy safeguards, tie-break, explanation UI, bias/fairness checks และ acceptance tests. ห้ามยืม raw synthetic reviews มาเป็นคะแนน.

## 4. Implementation ที่ทำตามคำตัดสิน

1. กฎ active เป็น version 3 และใช้ `platformMarkupRate`; version 1/2 เป็นประวัติ ไม่เขียนทับ.
2. เอา `complexityFactor` ออกจาก active rules; ruleset version 3 เก็บ multiplier คงที่ 1.0 และ endpoint ปฏิเสธ request body ที่พยายามส่งค่า urgency/complexity.
3. curated freshness ใช้ `reviewedAt` ไม่เกิน 30 วัน; live source ยังใช้ `sourceUpdatedAt` กับ `MARKET_PRICE_MAX_AGE_HOURS` (default 24). การตรวจอายุทำซ้ำตอนสร้าง, รับรอง และ publish; ไม่มีการเลื่อนวันทบทวนจากการอ่าน.
4. Matching คง eligibility filters และ `priority ASC, provider_id ASC`; B2C ใช้อันดับแรก, B2B ต้องมีสองราย, ไม่พบผู้สมัครเป็น `NO_PROVIDER_FOUND`. ไม่มี weighted score.
5. Unit tests ครอบคลุมตัวอย่างราคา 4 แบบ, factor เขต, rule invalid, rounding, curated stale boundary และ live freshness. Workflow integration tests ยังคงเป็น gate สำหรับ matching/API และต้องรันกับ PostgreSQL ทิ้งได้.
6. ไม่เปลี่ยน schema; หากเพิ่ม provider metrics ในอนาคตให้แยก scope/schema/API change ก่อน.

## 5. Verification / ข้อจำกัด

`npm run check` และ `python -m unittest tests/check_demo_v18_schema.py` ผ่าน; การตรวจรับรอบล่าสุด `npm test` ผ่าน 30/30 ไม่มี skip บน PostgreSQL 18.6 disposable cluster ตาม [validation report](validation.md). ติดตั้ง DDL และรัน seed v3; ตรวจ v1/v2 inactive และ v3 active. Integration ทดสอบ stale ปฏิเสธทั้ง estimate, accept และ publish; browser acceptance แสดงราคา B2C พร้อม reviewed/valid-through dates, caveat/source URLs และทดสอบ stale error ด้วย test-only catalog date override. Walkthrough UI ครบ 4 บทบาทบันทึกใน validation; ไม่ใช่การรับรองคุณภาพราคา/AI production.

## 6. Traceability ขั้น 1–6

| ขั้น | สิ่งที่เอกสารนี้ยึด |
|---|---|
| 1 — SRS | §13.7 curated/non-live, server-side versioned pricing, B2C ราคาเดียว, B2B ช่วง; FR-041 เป็นเป้าหมายผลิตภัณฑ์เต็ม ไม่ใช่หลักฐานกำไรจริงใน Demo |
| 2 — Use Cases/API | §10.1/10.2; B2C auto-match, B2B offers, unavailable/failure ไม่ publish |
| 3 — Activity | §7.1 curated estimate ก่อน publish; §7.3 matching branches/status |
| 4 — ERD/Data Dictionary | `pricing_rule_sets`, `price_estimates`, `provider_services`, `provider_districts`, `provider_profiles`, `offers`; ไม่มี provider quality score entity |
| 5 — API/Job State | §9 formula/ranking ปัจจุบันและ endpoint validation; การเปลี่ยน implementation ต้องเพิ่ม tests ตาม §4 |
| 6 — Wireframe | §7 handoff; แสดงราคา/source/non-live, ไม่แสดง weighted score และไม่อ้าง provider seed เป็นช่างจริง |

## 7. ข้อจำกัดและเกณฑ์ยอมรับ

- ตัวเลขตัวอย่างทั้งหมดเป็น seed assumptions เพื่อทดสอบสูตร ไม่ได้อ้างว่า 15% markup/70% reference share เป็นอัตราที่เหมาะสมเชิงตลาดหรือบัญชี.
- ไม่รวม actual part/software cost, travel receipt, VAT/tax, provider payout, negotiated commission, price-change request หรือ real provider quote.
- Curated source หมดอายุเมื่อเกิน 30 วันนับจาก reviewed date; หลังหมดอายุ estimate ต้อง fail closed จนมีคนทบทวน catalog.
- Matching คือกฎเรียง provider seed ไม่ใช่ AI matching และไม่มี score สาธารณะ.
- ผ่านขั้น 7 เมื่อ code/config, API behavior, unit/integration tests, source freshness, UI wording และเอกสารขั้น 1–6 ระบุ decision ชุดเดียวกัน.
