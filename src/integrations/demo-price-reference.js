// Manually reviewed public price examples for the student demo (reviewed 2026-09-25).
// These are indicative and heterogeneous service examples, not a live market feed or a quote.
import { IntegrationUnavailableError } from './errors.js';
const REVIEWED_AT = '2026-09-24T17:00:00.000Z'; // 2026-09-25 00:00 Asia/Bangkok
const entries = Object.freeze({
  SOFTWARE_ONLINE: {
    low: 300, high: 2500,
    note: 'ช่วงที่เผยแพร่สำหรับ remote support รายครั้ง; ระดับ/เวลางานต่างกันตามผู้ให้บริการ และไม่ใช่ราคาเฉพาะอาการของงานนี้',
    references: [
      'https://web.systemone.co.th/remote-support/',
      'https://www.helpdeskthai.com/'
    ]
  },
  HARDWARE_ONSITE: {
    low: 500, high: 800,
    note: 'ตัวอย่างค่าบริการเริ่มต้น/ซ่อมคอมที่เผยแพร่; อะไหล่และค่าเดินทางอาจไม่รวม',
    references: [
      'https://www.kimcomputerthailand.com/',
      'https://www.analogit.net/'
    ]
  }
});

export function createDemoPriceReferenceProvider({ reviewedAt = REVIEWED_AT } = {}) {
  return Object.freeze({
    async getReferencePrice({ category, serviceFormat }) {
      const key = `${category}_${serviceFormat}`;
      const entry = entries[key];
      if (!entry) {
        throw new IntegrationUnavailableError('ESTIMATE_UNAVAILABLE', 'ยังไม่มีราคาอ้างอิงที่ตรวจสอบได้สำหรับรูปแบบบริการนี้');
      }
      return {
        sourceName: 'Fixtech curated demo references (not real-time market data)',
        sourceReference: entry.references.join(' | '),
        sourceUpdatedAt: reviewedAt,
        referenceLow: entry.low,
        referenceHigh: entry.high,
        currency: 'THB',
        referenceNotes: entry.note,
        referenceType: 'CURATED_PUBLIC_EXAMPLES',
        reviewedAt
      };
    }
  });
}
