# Fixtech — ขอบเขตขยายจาก Demo ไปใช้งานจริง (ร่างข้อกำหนด)

**วันที่:** 2026-09-25  
**สถานะ:** ข้อกำหนดที่ผู้ใช้ขอเพิ่ม; ยังไม่ผ่านการตรวจรับ implementation  
**หลักการ:** ขั้น 1–7 ของ Demo v1.8 ยังเป็น baseline ที่ผ่านการตรวจรับตาม [validation](validation.md). เอกสารนี้กำหนดงานเพิ่มสำหรับรุ่นถัดไป โดยแยกสถานะและหลักฐานจาก Demo ให้ชัดเจน.

**ผลทบทวนล่าสุด:** [ตรวจความพร้อม Production ขั้น 1–7](production-readiness-review.md) ยังไม่ผ่าน; ตัวเริ่มแอปปฏิเสธ `NODE_ENV=production` จนกว่าจะมี integration และการตรวจรับจริง.

## เป้าหมายและเกณฑ์ตรวจรับ

| รหัส | สิ่งที่จะเพิ่ม | เกณฑ์ตรวจรับก่อนเปิดใช้จริง | สถานะปัจจุบัน |
|---|---|---|---|
| PROD-AI | AI วิเคราะห์อาการและช่วยร่างรายละเอียดงาน โดยลูกค้าตรวจและยืนยันก่อนโพสต์; มี consent, provenance, fallbacks, การวัดคุณภาพ/ความปลอดภัย และนโยบายข้อมูลจริง | ประเมินชุดเคส hardware/software ภาษาไทยที่ผู้เชี่ยวชาญตรวจคำตอบ, ทดสอบข้อมูลอ่อนไหว/คำแนะนำเสี่ยง/ความล้มเหลวของโมเดล, ระบุ provider และข้อตกลงการประมวลผลข้อมูล | Demo ใช้ Ollama local กับข้อมูลสังเคราะห์; ยังไม่มีการประเมินคุณภาพ/ความปลอดภัยสำหรับข้อมูลจริง |
| PROD-PRICE | ราคาอ้างอิงตลาดที่อัปเดตจากแหล่งข้อมูลที่มีสิทธิ์ใช้งาน พร้อมเวลาเก็บและเวลาอัปเดตของแหล่ง, เขต, ประเภทงาน, ค่าแรง/อะไหล่/เดินทาง/ค่าธรรมเนียม และ version ของสูตร | มีสัญญาหรือสิทธิ์ใช้ API/data, mapping และ coverage สำหรับงานที่เปิดขาย, TTL และ stale rejection, reconcile ตัวเลขกับแหล่งจริง, แสดงช่วงราคา/สมมติฐานและราคาที่ช่างเสนอแยกกัน; หากข้อมูลไม่พอให้หยุดประเมิน | Demo ใช้ curated reference ไม่สด; ยังไม่มีแหล่งตลาดจริงที่ยืนยันสิทธิ์/coverage |
| PROD-PAY | ชำระเงินจริงผ่านผู้ให้บริการรับชำระที่เหมาะกับไทย; บริษัทชำระผ่านแพลตฟอร์ม, ลูกค้าทั่วไปเลือกชำระตรงหรือผ่านระบบตามนโยบาย | ใช้ hosted checkout/tokenization โดยไม่เก็บข้อมูลบัตร; ยอดจาก server, webhook ตรวจลายเซ็น, idempotency, สถานะ pending/paid/failed/refunded, reconciliation, refund/chargeback, ledger/audit, sandbox → live test, สัญญาและรูปแบบการรับ/ส่งต่อเงินผ่านการทบทวนโดยผู้เชี่ยวชาญ | มีเพียง payment simulation; ไม่มีเงินจริงหรือการถือ/จ่ายเงินแทนช่าง |
| PROD-KYC | ตรวจตัวตนช่าง/ทีมช่างและเอกสารวิชาชีพที่จำเป็นก่อนรับงาน | เลือกผู้ให้บริการหรือวิธีตรวจที่ตรวจสอบได้, consent/แจ้งวัตถุประสงค์, เก็บข้อมูลขั้นต่ำใน private storage, role restriction, review/reject/expire/reverify, audit, retention/deletion, ทดสอบการปลอมเอกสารและการเข้าถึงข้ามบัญชี | Demo ใช้ช่าง seed; ไม่มีการตรวจตัวตนจริง |
| PROD-SEC | ตรวจความปลอดภัยระบบและแก้ผลตรวจทุกข้อระดับวิกฤต/สูงก่อนเปิดจริง | ระบุ threat model/data flow, ตรวจ dependency/SAST, ทดสอบ auth/authorization/CSRF/session/upload/SSRF/rate limit/secrets, ทดสอบเชิงรุกใน staging, backup/restore, logging/monitoring, บันทึก findings/เจ้าของงาน/หลักฐาน retest และผู้อนุมัติ release; ใช้ OWASP ASVS เป็นกรอบ | มีมาตรการบางส่วนใน Demo แต่ยังไม่มี audit ครบ; `npm audit` รอบ 2026-09-25 ติดต่อ advisory endpoint ไม่สำเร็จ จึงไม่มีผลสแกน dependency ที่ยืนยันได้ |
| PROD-A11Y | ตรวจและปรับหน้าเว็บตาม WCAG 2.2 ระดับ AA ทุก flow/viewport ที่ใช้งาน | ระบุ browser/assistive technology baseline, ประเมินทุก page/state สำคัญ รวม modal, error, uploads, payment/KYC, keyboard, screen reader, zoom/reflow, contrast; บันทึก success criteria รายข้อและหลักฐาน retest ตาม WCAG-EM แล้วออกผลตรวจรับที่ระบุขอบเขต/วันที่ | Demo ตรวจ responsive, focus และบางคู่สีแล้ว; ยังไม่ได้ตรวจ WCAG ครบ |

## ลำดับออกแบบที่มีผลต่อ schema และ API

1. **กำหนดผู้ให้บริการและข้อตกลงข้อมูล:** เลือก payment gateway/merchant model, แหล่งราคาที่มีสิทธิ์, ผู้ตรวจตัวตน และ AI สำหรับข้อมูลจริง. ระบุค่าใช้จ่าย การเก็บข้อมูล และ failure mode ก่อนเชื่อมระบบ.
2. **ออกแบบฐานข้อมูลรุ่นถัดไป:** เพิ่ม payment intents/events/refunds/ledger และ webhook deduplication; เพิ่ม identity cases/evidence/review/expiry; เพิ่ม price-source snapshots/freshness/coverage. ใช้ migration versioned; ห้ามเปลี่ยนตาราง Demo ที่ติดตั้งแล้วโดยไม่มี migration และ rollback plan.
3. **ขยาย API/state:** การชำระเงินต้องยืนยันจาก webhook ที่ตรวจลายเซ็น ไม่ให้ลูกค้ากดเปลี่ยนเป็น paid เอง; การยืนยันตัวตนต้องเป็น prerequisite ก่อนช่างรับงาน; ราคา snapshot ต้องบันทึก source version และ timestamp. ทุก endpoint มี authorization, idempotency, audit และ test ของกรณีซ้ำ/ช้า/ผิดลำดับ.
4. **ขยาย UI:** แสดงสถานะจริงตาม server, ความยินยอมและสิทธิ์ถอนข้อมูล, ความไม่แน่นอนของ AI/ราคา, ค่าบริการ/นโยบายคืนเงิน และสถานะตรวจช่าง. ออกแบบให้ทดสอบ keyboard/screen reader ได้ตั้งแต่ต้น.
5. **ตรวจรับ:** sandbox providers → staged end-to-end → security/accessibility assessment → go-live checklist. เก็บหลักฐานผลทดสอบพร้อมวัน, environment และผู้ตรวจ.

## แนวทางผู้ให้บริการและข้อมูลที่เหมาะกับ Fixtech

ข้อเสนอเหล่านี้เป็น **รายชื่อสำหรับพิสูจน์ความเป็นไปได้** ณ วันที่จัดทำเอกสาร ยังไม่ได้สมัครบัญชีหรือยืนยันราคา/เงื่อนไขเชิงพาณิชย์.

| งาน | ทางเลือกแรกสำหรับการพิสูจน์ | เหตุผลและสิ่งที่ต้องตรวจเพิ่มเติม |
|---|---|---|
| รับชำระในไทย | **Opn/Omise test mode** | มีคู่มือการรับชำระในไทย, test/live mode, webhook และ API recipient/transfer. เริ่มด้วย sandbox ของการจ่ายเงินจากลูกค้า; ก่อนทำการจ่ายช่างหรือหักค่าคอมมิชชัน ให้ยืนยันกับ Opn ว่าบัญชี/สัญญารองรับ marketplace, การรับแทน, การโอนให้ผู้รับ, refund/chargeback และค่าธรรมเนียมตามโมเดล Fixtech. อย่าอนุมานว่า API transfer ที่มีอยู่เท่ากับได้รับอนุญาตให้ทำ escrow. [คู่มือ webhook](https://docs.opn.ooo/api-webhooks), [ธนาคารไทยที่รองรับ recipient](https://docs.opn.ooo/supported-banks), [ช่องทางชำระในไทย](https://docs.opn.ooo/integrations/thailand) |
| ตรวจตัวตนช่าง | **พิสูจน์แนวทาง eKYC กับผู้ให้บริการไทย; เปรียบเทียบ iApp/NDID ตามสิทธิ์ใช้งาน** | iApp มี API สำหรับ OCR เอกสารไทย, face verification และ liveness; ฟังก์ชันเหล่านี้ไม่ได้ยืนยันเองว่าเอกสารเป็นของจริงหรือผ่านการตรวจฐานรัฐ. NDID เป็นโครงสร้างยืนยันตัวตนที่ต้องสอบถามรูปแบบเข้าร่วมและค่าใช้จ่าย. ต้องทดสอบความเหมาะสมกับบทบาทช่างบุคคล/นิติบุคคลและให้ Admin ตรวจผล/อุทธรณ์. [iApp API contracts](https://github.com/iapp-technology/iapp-ekyc-sdk/blob/main/docs/API_CONTRACTS.md), [NDID](https://ndid.co.th/en/ndid-en/) |
| ราคาในตลาด | **ข้อมูลราคาที่ช่าง/ทีมช่างเสนอจริงใน Fixtech + rate card ที่ช่างเผยแพร่และยืนยันเวลา** | เป็นแหล่งเริ่มต้นที่มี timestamp ชัดและใช้ได้เมื่อข้อตกลงกับช่างอนุญาต แต่สะท้อนเฉพาะเครือข่ายช่าง Fixtech ไม่ใช่ตลาดทั้งหมด. แยก `current_provider_quotes` จาก `external_market_reference`; ระบุจำนวนตัวอย่าง, เขต, หมวดงาน, อายุข้อมูลและราคาอะไหล่. B2C ต้องมี rate card ที่พอประเมินยอดก่อนเผยแพร่/จับคู่อัตโนมัติ; หากไม่มีให้คง Draft ขอข้อมูล/ให้ Admin ทบทวน. B2B ยังแสดงช่วงก่อนเผยแพร่และยอดข้อเสนอจริงหลังโพสต์. ราคาอะไหล่/ค่าซ่อมของผู้ผลิต เช่น [Apple Thailand](https://support.apple.com/th-th/mac-laptops/repair) ใช้เพื่อเปรียบเทียบโดยคนตรวจและตามสิทธิ์ที่อนุญาต; ยังไม่พบ API สาธารณะที่รับรองความครอบคลุมงานซ่อมคอม/ซอฟต์แวร์ทั่วกรุงเทพ. |
| ค่าครองชีพ/เงินเฟ้อ | **ดัชนี CPI กรุงเทพและปริมณฑลของ TPSO** | เป็นข้อมูลทางการที่ออกเป็นรอบเดือน ใช้ปรับ baseline เมื่ออัปเดต ไม่ใช่ราคาซ่อมแบบ real-time. แสดงเดือนข้อมูลเสมอและกำหนดเพดานผลกระทบต่อราคา; ห้ามเติมคำว่า live เพียงเพราะระบบดึงข้อมูลอัตโนมัติ. [TPSO CPI](https://index.tpso.go.th/) |

**คำตัดสินเรื่อง real-time:** นิยามสำหรับ Fixtech ว่า *ราคาเสนอจากช่าง ณ เวลานั้น* เป็น live quote; *ราคาอ้างอิงตลาด* จะใช้ป้าย “อัปเดต ณ …” ตามอายุของแหล่งข้อมูล. ถ้าภายหลังได้ licensed market API ที่มี SLA/coverage จึงเพิ่ม provider อีกตัวและทดสอบความสดตามสัญญา. AI จัดหมวดอาการ/ช่วยสรุป แต่ไม่เป็นแหล่งตัวเลขราคา.

## ระยะงานสำหรับทีม 3 คน

| ระยะ | งานที่ส่งมอบ | เจ้าของหลัก | Gate |
|---|---|---|---|
| A — ตัดสินธุรกิจและ provider | merchant/ค่าคอมมิชชัน/คืนเงิน, เงื่อนไขช่าง, ข้อมูลส่วนบุคคล, payment/eKYC sandbox, แหล่งราคาและสิทธิ์ใช้ | คนที่ 3 ประสาน; ทุกคนทบทวน | เอกสารข้อตกลงและบัญชีทดสอบพร้อม; ถ้ายังไม่พร้อมไม่อ้างว่า live |
| B — ฐานข้อมูลและ API รุ่นใหม่ | migrations, payment intent/webhook/ledger, verification case, price snapshots, audit | คนที่ 2 รับ lifecycle/payment; คนที่ 3 รับ schema/security | tests ของสิทธิ์, ซ้ำ, timeout, failure และ rollback ผ่าน |
| C — หน้าเว็บและการเข้าถึง | checkout/KYC/price provenance, error/retry, keyboard/screen reader | คนที่ 1 รับ customer/provider UI; คนที่ 3 ตรวจร่วม | จบ flow sandbox ครบ 4 บทบาทและเริ่ม WCAG-EM report |
| D — ตรวจปล่อย | reconciliation/refunds, security findings, WCAG 2.2 AA report, backup/restore และ monitoring | ทุกคนทดสอบข้าม slice; ผู้ประเมินภายนอกเมื่อมี | หลักฐาน retest และผู้รับผิดชอบลงนามก่อนเปิดเงินจริง |

ให้ทำเป็นรุ่น/ฐานข้อมูลแยกจาก Demo v1.8; ระยะ A เป็นตัวกำหนดรายละเอียดของ B–D. ด้วยทีม 3 นักศึกษายังไม่ควรกำหนดวันเปิดเงินจริงก่อนทราบบัญชีผู้ให้บริการ สัญญา และผู้ตรวจอิสระ.

## จุดเริ่มตรวจ Security และ Accessibility จากโค้ดปัจจุบัน

นี่เป็น **รายการสำหรับ audit** จากการอ่านโค้ดเบื้องต้น ไม่ใช่ผล audit ที่ปิดแล้ว:

- Login throttle อยู่ใน `Map` ของ process เดียว; ออกแบบ rate limit ที่ใช้ร่วมกันข้าม instance และตรวจการสะสมข้อมูล/การหลบหลีกด้วย IP หรืออีเมล.
- Session เป็น cookie ลงลายเซ็นที่หมดอายุตามเวลา; ออกแบบ revocation, session rotation หลังเปลี่ยนสิทธิ์/รหัสผ่าน และอุปกรณ์ที่ล็อกอินอยู่.
- `SameSite=Strict` และ Helmet มีอยู่แล้ว; ทดสอบ CSRF และ Origin สำหรับทุกคำขอเปลี่ยนข้อมูล รวม webhook/redirect ของผู้ให้บริการภายนอกที่ต้องมี policy เฉพาะ.
- ไฟล์ภาพตรวจ MIME/signature, size และสิทธิ์แล้ว; สำหรับข้อมูลจริงต้องเพิ่ม malware scanning, quarantine, retention/deletion ที่บังคับใช้ และทดสอบไฟล์ที่ parser ปลายทางจัดการผิด.
- หน้าปัจจุบันเคยตรวจ focus, สีบางคู่ และ responsive แล้ว; ต้องตรวจ dynamic dialogs, error announcement, labels, screen reader, zoom/reflow และทุกสถานะหลังเพิ่ม checkout/KYC ตามเกณฑ์ WCAG 2.2 AA.

ผล `npm audit` รอบนี้ไม่สามารถอ่าน advisory endpoint ได้ จึงไม่มีสถานะ dependency vulnerability ที่ยืนยันได้. ให้รันซ้ำใน CI ที่เข้าถึง registry และบันทึก SBOM/เวอร์ชันที่ตรวจ.

## เรื่องที่ต้องตัดสินก่อนลงมือเชื่อมเงินจริง

- **ผู้รับเงินจริงและการจ่ายช่าง:** ใครเป็น merchant of record, เงินผ่านบัญชีใคร, หักค่าคอมมิชชันเมื่อใด, ใครออกใบเสร็จ/จัดการคืนเงิน/ข้อพิพาท. ต้องทบทวนรูปแบบธุรกิจกับผู้ให้บริการและผู้เชี่ยวชาญในไทยก่อนเปิดใช้. ธนาคารแห่งประเทศไทยระบุว่าบริการรับชำระแทนผู้อื่นบางประเภทอยู่ภายใต้การกำกับ.
- **ราคา “real-time” หมายถึงอะไร:** แหล่งที่ให้ timestamp และความถี่ update จริง, coverage ของงาน/เขต, เงื่อนไขการใช้ข้อมูล. ถ้าไม่มี feed ที่เหมาะสม ให้แสดงราคาประเมินพร้อมอายุข้อมูลตามจริง ห้ามใช้คำว่า real-time.
- **ระดับการรับรอง WCAG:** เป้าหมายเริ่มต้นคือ WCAG 2.2 AA ครบทุกหน้าที่อยู่ในขอบเขต; หากผู้ใช้หมายถึง AAA ให้กำหนดเป็นเป้าราย success criterion เพราะ W3C ไม่แนะนำให้กำหนด AAA ทั้งเว็บไซต์ทั่วไป.

## แหล่งอ้างอิงหลัก

- [ธนาคารแห่งประเทศไทย — การกำกับตาม พ.ร.บ. ระบบการชำระเงิน](https://www.bot.or.th/th/our-roles/payment-systems/back-up-payment.html)
- [W3C — WCAG 2.2 และเงื่อนไข conformance](https://www.w3.org/TR/wcag/)
- [W3C — WCAG Evaluation Methodology 2.0](https://www.w3.org/TR/WCAG-EM/)
- [OWASP — Application Security Verification Standard](https://owasp.org/projects/asvs)
- [TPSO — ดัชนีราคาผู้บริโภค](https://index.tpso.go.th/)
