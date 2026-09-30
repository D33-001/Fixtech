import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/integrations/ollama.js';

test('Ollama analysis calls only loopback and validates the structured response', async () => {
  let request;
  const provider = createOllamaProvider({ fetchImpl: async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ summary: 'สรุปอาการ', missingInfo: [], safeGuidance: ['ปิดเครื่องก่อนตรวจ'] }) } }) };
  } });
  const result = await provider.analyze({ symptom: 'เครื่องเปิดไม่ติด ติดต่อ customer@example.com', category: 'HARDWARE', attachments: [] });
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(request.body.model, 'gemma3:4b');
  assert.deepEqual(request.body.messages[1].images, undefined);
  assert.match(request.body.messages[1].content, /\[อีเมลถูกปกปิด\]/);
  assert.doesNotMatch(request.body.messages[1].content, /customer@example\.com/);
  assert.equal(result.provider, 'ollama-local');
  assert.equal(result.summary, 'สรุปอาการ');
});

test('Ollama chat passes bounded history and normalizes its answer', async () => {
  let request;
  const provider = createOllamaProvider({ fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: '{"answer":"แนะนำให้นำส่งช่าง"}' } }) };
  } });
  const result = await provider.chat({ question: 'ทำอย่างไรต่อ', history: [{ question: 'เดิม', answer: 'ตอบ' }], symptom: 'เครื่องดับ', category: 'HARDWARE' });
  assert.match(request.messages[1].content, /ทำอย่างไรต่อ/);
  assert.equal(result.answer, 'แนะนำให้นำส่งช่าง');
});

test('Ollama rejects non-loopback hosts and malformed structured output', async () => {
  assert.throws(() => createOllamaProvider({ baseUrl: 'https://example.com' }), /loopback/);
  const provider = createOllamaProvider({ fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: 'not json' } }) }) });
  await assert.rejects(provider.analyze({ symptom: 'อาการ', category: 'SOFTWARE' }), (error) => error.code === 'AI_PROVIDER_UNAVAILABLE');
});

test('Ollama replaces unsafe hardware and destructive-software instructions with safe guidance', async () => {
  const provider = createOllamaProvider({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    const content = request.messages[1].content.includes('คำถาม:')
      ? { answer: 'ใช้เครื่องเป่าลมทำความสะอาดพัดลมและเปิดฝาเครื่อง' }
      : { summary: 'เครื่องทำงานช้า', missingInfo: [], safeGuidance: ['ฟอร์แมตเครื่องใหม่', 'ใช้เครื่องเป่าลมทำความสะอาดพัดลม', 'ถอดปลั๊กไฟทันที'] };
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) };
  } });
  const analysis = await provider.analyze({ symptom: 'เครื่องช้า', category: 'SOFTWARE' });
  assert.equal(analysis.safeGuidance.length, 1);
  assert.match(analysis.safeGuidance[0], /ติดต่อช่าง/);
  const chat = await provider.chat({ question: 'ควรทำอย่างไร', symptom: 'เครื่องช้า', category: 'SOFTWARE' });
  assert.match(chat.answer, /ติดต่อช่าง/);
  assert.doesNotMatch(chat.answer, /เป่าลม|ฟอร์แมต|เปิดฝา/);
});
