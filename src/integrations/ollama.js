import { readFile } from 'node:fs/promises';
import { IntegrationUnavailableError } from './errors.js';

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    missingInfo: { type: 'array', items: { type: 'string' } },
    safeGuidance: { type: 'array', items: { type: 'string' } }
  }, required: ['summary', 'missingInfo', 'safeGuidance']
};
const CHAT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { answer: { type: 'string' } }, required: ['answer']
};
const UNSAFE_ACTION_PATTERN = /(?:แกะ|ถอด|เปิด)(?:ฝา|เครื่อง|อุปกรณ์|เคส|พัดลม|แบต|วงจร)|ถอดปลั๊ก|ดึงปลั๊ก|เป่าลม|ฉีด(?:ลม|น้ำ|สเปรย์)?|สเปรย์|(?:พัดลม|ภายในเครื่อง|ช่องระบาย).{0,30}ทำความสะอาด|(?:ทำความสะอาด).{0,30}(?:พัดลม|ภายในเครื่อง|ช่องระบาย)|ฟอร์แมต|format|ล้างข้อมูล|(?:ติดตั้ง|ลง).{0,20}(?:วินโดวส์|windows).{0,20}ใหม่|รีเซ็ตโรงงาน|factory reset|(?:อัปเดต|อัพเดท|ปรับค่า).{0,20}bios/i;

function hasUnsafeAction(value) { return UNSAFE_ACTION_PATTERN.test(value); }
function safeFallback() {
  return 'เพื่อความปลอดภัย อย่าเปิดหรือแกะอุปกรณ์ และอย่าลบหรือติดตั้งระบบใหม่เอง หากเครื่องร้อนจัด มีกลิ่นไหม้ หรือมีเสียงผิดปกติ ให้หยุดใช้งานและติดต่อช่าง พร้อมแจ้งรุ่นเครื่องและอาการที่พบ';
}

function localEndpoint(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('OLLAMA_BASE_URL must be a valid local URL'); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Ollama must use a loopback URL; remote hosts are not allowed for this local-only integration');
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

function redactPersonalDetails(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[อีเมลถูกปกปิด]')
    .replace(/(?:\+?66|0)[\s().-]*\d(?:[\s().-]*\d){7,9}/g, '[เบอร์โทรถูกปกปิด]')
    .replace(/(?:ที่อยู่|บ้านเลขที่|เลขที่อยู่|เลขที่|ซอย|ถนน|แขวง|เขต|จังหวัด|ตำบล|อำเภอ)\s*[^\n,;]{0,100}/g, '[ข้อมูลที่อยู่อาจถูกปกปิด]');
}

export function createOllamaProvider({ baseUrl = 'http://127.0.0.1:11434', model = 'gemma3:4b', timeoutMs = 120_000, fetchImpl = fetch } = {}) {
  const endpoint = localEndpoint(baseUrl);
  if (!model.trim() || model.length > 120) throw new Error('OLLAMA_MODEL is invalid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw new Error('OLLAMA_TIMEOUT_MS must be 1000..300000');

  async function generate({ system, prompt, images = [], schema }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const encodedImages = await Promise.all(images.map(async ({ path }) => (await readFile(path)).toString('base64')));
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          model, stream: false, format: schema, options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt, ...(encodedImages.length ? { images: encodedImages } : {}) }
          ]
        })
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const payload = await response.json();
      if (typeof payload.message?.content !== 'string') throw new Error('Ollama response has no message content');
      let parsed;
      try { parsed = JSON.parse(payload.message.content); } catch { throw new Error('Ollama response is not valid JSON'); }
      return parsed;
    } catch (error) {
      throw new IntegrationUnavailableError('AI_PROVIDER_UNAVAILABLE', error.name === 'AbortError' ? 'Local AI request timed out' : 'Local AI is unavailable or returned an invalid response');
    } finally { clearTimeout(timer); }
  }

  return Object.freeze({
    providerName: 'ollama-local', model,
    async analyze({ symptom, category, attachments = [] }) {
      const output = await generate({
        system: 'คุณเป็นผู้ช่วยคัดกรองอาการอุปกรณ์ไอทีเบื้องต้นเท่านั้น ห้ามยืนยันสาเหตุหรือราคา ห้ามแนะนำให้เปิด/แกะ/ถอดอุปกรณ์ ทำความสะอาดภายใน เป่าลมหรือฉีดสเปรย์ ลบข้อมูล ฟอร์แมต ติดตั้งระบบใหม่ หรือแก้ BIOS ระบุความไม่แน่นอน แนะนำเฉพาะการสังเกตอาการและการหยุดใช้อย่างปลอดภัย ตอบภาษาไทยใน JSON ตาม schema เท่านั้น',
        prompt: `หมวดงาน: ${category}\nอาการที่ผู้ใช้แจ้ง: ${redactPersonalDetails(symptom)}\nสรุปอย่างระมัดระวัง ระบุข้อมูลที่ควรถามเพิ่ม และคำแนะนำที่ปลอดภัย`,
        images: attachments, schema: ANALYSIS_SCHEMA
      });
      if (typeof output.summary !== 'string' || !Array.isArray(output.missingInfo) || !Array.isArray(output.safeGuidance) ||
          output.summary.length > 1000 || output.missingInfo.length > 10 || output.safeGuidance.length > 10 ||
          [...output.missingInfo, ...output.safeGuidance].some((item) => typeof item !== 'string' || item.length > 300)) {
        throw new IntegrationUnavailableError('AI_INVALID_RESPONSE', 'Local AI response did not match the required schema', 502);
      }
      const safeGuidance = output.safeGuidance.some(hasUnsafeAction) ? [safeFallback()] : output.safeGuidance;
      return { ...output, safeGuidance, provider: 'ollama-local', model };
    },
    async chat({ question, history = [], symptom, category, attachments = [] }) {
      const output = await generate({
        system: 'คุณเป็นผู้ช่วยคัดกรองอาการอุปกรณ์ไอทีเบื้องต้นเท่านั้น ห้ามยืนยันสาเหตุหรือราคา ห้ามแนะนำให้เปิด/แกะ/ถอดอุปกรณ์ ทำความสะอาดภายใน เป่าลมหรือฉีดสเปรย์ ลบข้อมูล ฟอร์แมต ติดตั้งระบบใหม่ หรือแก้ BIOS ให้แนะนำช่างเมื่อไม่แน่ใจ ตอบภาษาไทยใน JSON ตาม schema เท่านั้น',
        prompt: `หมวดงาน: ${category}\nอาการ: ${redactPersonalDetails(symptom)}\nบทสนทนาก่อนหน้า: ${JSON.stringify(history.slice(-10).map((turn) => ({ question: redactPersonalDetails(turn.question), answer: turn.answer })))}\nคำถาม: ${redactPersonalDetails(question)}`,
        images: attachments, schema: CHAT_SCHEMA
      });
      if (typeof output.answer !== 'string' || !output.answer.trim() || output.answer.length > 4000) {
        throw new IntegrationUnavailableError('AI_INVALID_RESPONSE', 'Local AI response did not match the required schema', 502);
      }
      const answer = hasUnsafeAction(output.answer) ? safeFallback() : output.answer.trim();
      return { answer, provider: 'ollama-local', model };
    }
  });
}
