export function registerAiScreeningApi(app, { aiProvider }) {
  app.post('/api/ai/screen-chat', async (req, res) => {
    let messages = req.body?.messages;
    if (!messages && Array.isArray(req.body?.conversationHistory)) {
      messages = req.body.conversationHistory;
    }
    if (!messages && typeof req.body?.message === 'string' && req.body.message.trim()) {
      messages = [{ role: 'user', content: req.body.message.trim() }];
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'messages ต้องเป็น Array และไม่ว่าง' } });
    }

    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const fullConversation = messages.map((m) => `${m.role === 'user' ? 'ลูกค้า' : 'AI'}: ${m.content}`).join('\n');

    // Rule-based entity & symptom extractor for reliable offline screening
    const lower = fullConversation.toLowerCase();
    const isNotebook = /(?:โน้ตบุ๊ก|โน้ตบุค|โนตบุค|notebook|laptop|แล็ปท็อป|แลปทอป|macbook|แมคบุ๊ค)/i.test(lower);
    const isDesktop = /(?:คอมตั้งโต๊ะ|ตั้งโต๊ะ|desktop|pc|พีซี|เคส|case)/i.test(lower);
    const isSoftware = /(?:เปิดโปรแกรม|เข้าวินโดวส์ไม่ได้|ไวรัส|จอฟ้า|bluescreen|bsod|อัปเดต|ค้าง|ช้า|ลงโปรแกรม|เปิดไฟล์)/i.test(lower);
    const hasPowerIssue = /(?:เปิดไม่ติด|ไฟไม่เข้า|พัดลมไม่หมุน|ดับเอง|เสียงร้อง|beep|ไฟกระพริบ)/i.test(lower);
    const hasScreenIssue = /(?:จอไม่ติด|จอมืด|ภาพลาย|เส้นขึ้น|no signal)/i.test(lower);
    const hasBatteryIssue = /(?:แบตเสื่อม|ชาร์จไม่เข้า|สายชาร์จ|แบตหมดเร็ว|ถอดสายดับ)/i.test(lower);
    const hasDamage = /(?:ตก|หล่น|น้ำหก|โดนน้ำ|ชื้น|กระแทก)/i.test(lower);

    let deviceType = isNotebook ? 'NOTEBOOK' : (isDesktop ? 'DESKTOP' : null);
    let category = (isSoftware && !hasDamage && !hasBatteryIssue) ? 'SOFTWARE' : 'HARDWARE';
    let serviceFormat = category === 'SOFTWARE' ? 'ONLINE' : 'ONSITE';

    // Extract device brand or model
    let deviceBrandOrModel = 'ไม่ระบุรุ่น';
    const brandMatch = fullConversation.match(/(?:asus|acer|lenovo|dell|hp|apple|macbook|msi|gigabyte|samsung|huawei|sony)[\w\s\-]*/i);
    if (brandMatch) {
      deviceBrandOrModel = brandMatch[0].trim();
    }

    // Determine missing info
    const userTurnCount = messages.filter((m) => m.role === 'user').length;
    let reply = '';
    let isComplete = false;

    if (!deviceType && userTurnCount === 1) {
      reply = 'สวัสดีครับ ผมเป็น AI ผู้ช่วยคัดกรองอาการของ Fixtech เพื่อช่วยสร้างการ์ดงานหาช่างให้คุณครับ\n\nรบกวนสอบถามเบื้องต้นครับว่า อุปกรณ์ที่มีปัญหาคือ **คอมพิวเตอร์ตั้งโต๊ะ (Desktop PC)** หรือ **โน้ตบุ๊ก (Notebook / Laptop)** และเป็นยี่ห้อหรือรุ่นใดครับ?';
    } else if (deviceType === 'NOTEBOOK' && !hasBatteryIssue && !hasDamage && userTurnCount <= 2) {
      reply = `รับทราบครับ เป็นโน้ตบุ๊ก (${deviceBrandOrModel})\n\nรบกวนสอบถามเพิ่มเติม:\n1. ตอนนี้เสียบสายชาร์จแล้วมีไฟสถานะขึ้นไหมครับ หรือใช้งานจากแบตเตอรี่ได้อย่างเดียว?\n2. ก่อนเกิดอาการ เคยมีประวัติตกหล่น กระแทก หรือโดนน้ำ/ความชื้นมาก่อนหรือไม่ครับ?`;
    } else if (deviceType === 'DESKTOP' && !hasPowerIssue && !hasScreenIssue && userTurnCount <= 2) {
      reply = `รับทราบครับ เป็นคอมพิวเตอร์ตั้งโต๊ะ (${deviceBrandOrModel})\n\nรบกวนสอบถามเพิ่มเติม:\n1. ตอนกดเปิดเครื่อง พัดลมหมุน หรือมีเสียงร้องเตือน (Beep code) สั้น-ยาว อย่างไรบ้างไหมครับ?\n2. หน้าจอมืดสนิท หรือขึ้นว่า No Signal / มีภาพติดแล้วดับไปครับ?`;
    } else {
      // Gathered enough info or multi-turn completed -> generate draft card!
      isComplete = true;
      reply = 'ขอบคุณสำหรับข้อมูลครบถ้วนครับ! ผมได้รวบรวมและวิเคราะห์อาการเบื้องต้น พร้อมจัดทำ **"ตัวอย่างการ์ดงาน (Draft Job Card)"** ให้คุณตรวจสอบเรียบร้อยแล้วครับ ด้านล่างนี้คือสรุปอาการและข้อมูลสำคัญสำหรับช่าง คุณสามารถแนบรูปภาพเพิ่มเติม และกดยืนยันเพื่อเผยแพร่หาช่างได้ทันทีครับ';
    }

    // Generate checklist & summary
    const checklist = [];
    if (deviceType === 'NOTEBOOK') {
      checklist.push(`ประเภท: โน้ตบุ๊ก (${deviceBrandOrModel})`);
      if (hasBatteryIssue) checklist.push('พบปัญหาเกี่ยวกับระบบแบตเตอรี่หรือไฟชาร์จ');
      if (hasDamage) checklist.push('มีประวัติเสี่ยงตกหล่นหรือสัมผัสความชื้น/น้ำ');
      checklist.push('ตรวจสอบหน้าจอ, คีย์บอร์ด และระบบระบายความร้อน');
    } else {
      checklist.push(`ประเภท: คอมตั้งโต๊ะ Desktop PC (${deviceBrandOrModel})`);
      if (hasPowerIssue) checklist.push('ตรวจสอบสถานะไฟ Power Supply / พัดลมระบายความร้อน / เมนบอร์ด');
      if (hasScreenIssue) checklist.push('ตรวจสอบการ์ดจอ สายสัญญาณ และหน้าจอแสดงผล');
      checklist.push('ตรวจเช็คแรมและสัญญาณเสียงเตือนเริ่มต้น (POST / Beep codes)');
    }

    const aiSummary = `[${deviceType ?? 'อุปกรณ์คอมพิวเตอร์'}] ${lastMessage.slice(0, 300)} (วิเคราะห์เบื้องต้น: หมวด ${category} - ${serviceFormat === 'ONSITE' ? 'บริการนอกสถานที่' : 'บริการออนไลน์'})`;

    const draftCard = isComplete ? {
      category,
      serviceFormat,
      deviceType: deviceType ?? 'NOTEBOOK',
      deviceBrandOrModel,
      aiSummary,
      checklist,
      keyChecklist: checklist,
      isComplete: true
    } : null;

    res.json({
      data: {
        reply,
        isComplete,
        draftCard
      }
    });
  });
}
