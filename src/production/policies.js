// Production domain rules. These are not wired into the Demo routes.
export class ProductionPolicyError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductionPolicyError'; this.code = code; }
}

function reject(code, message) { throw new ProductionPolicyError(code, message); }

export function bahtToMinor(amount) {
  const text = String(amount ?? '');
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(text)) reject('INVALID_AMOUNT', 'จำนวนเงินต้องเป็นเงินบาทที่มีทศนิยมไม่เกินสองตำแหน่ง');
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) reject('INVALID_AMOUNT', 'จำนวนเงินต้องมากกว่าศูนย์');
  return minor;
}

export function preparePaymentIntent({ job, customer, method }) {
  if (!job || !customer || job.customer_user_id !== customer.id) reject('NOT_OWNER', 'ผู้ใช้ไม่ได้เป็นเจ้าของงาน');
  if (job.status !== 'COMPLETED') reject('JOB_NOT_COMPLETED', 'ต้องตรวจรับงานก่อนเริ่มชำระ');
  if (!job.assigned_provider_id) reject('PROVIDER_NOT_ASSIGNED', 'งานไม่มีช่างที่รับผิดชอบ');
  if (!['GATEWAY', 'DIRECT'].includes(method)) reject('INVALID_METHOD', 'วิธีชำระไม่ถูกต้อง');
  if (customer.role === 'CUSTOMER_BUSINESS' && method !== 'GATEWAY') reject('BUSINESS_MUST_USE_GATEWAY', 'ลูกค้าบริษัทต้องชำระผ่านแพลตฟอร์ม');
  if (!['CUSTOMER_GENERAL', 'CUSTOMER_BUSINESS'].includes(customer.role)) reject('INVALID_ROLE', 'บัญชีนี้ไม่สามารถชำระเงิน');
  return { amountMinor: bahtToMinor(job.agreed_amount), currency: 'THB', method };
}

export function verifiedTechnicianIsEligible({ provider, verification, now = new Date() }) {
  const current = new Date(now).getTime();
  const expiry = Date.parse(verification?.expires_at ?? '');
  return Boolean(provider?.is_approved && provider?.is_available && verification?.provider_id === provider?.id &&
    verification?.status === 'VERIFIED' && Number.isFinite(expiry) && expiry > current);
}

export function verifiedGatewayStatus({ intent, charge, expectedLiveMode }) {
  if (intent?.method !== 'GATEWAY' || !intent?.gateway_charge_id || !charge ||
      charge.id !== intent.gateway_charge_id || charge.currency !== intent.currency ||
      charge.amount !== Number(intent.amount_minor) || charge.livemode !== expectedLiveMode) {
    reject('CHARGE_MISMATCH', 'รายการจากผู้ให้บริการไม่ตรงกับรายการที่ระบบสร้าง');
  }
  if (!['pending', 'successful', 'failed', 'expired'].includes(charge.status)) reject('UNKNOWN_CHARGE_STATUS', 'สถานะจากผู้ให้บริการไม่รองรับ');
  return { pending: 'AWAITING_CUSTOMER', successful: 'PAID', failed: 'FAILED', expired: 'EXPIRED' }[charge.status];
}

export function networkReference({ rateCards, category, serviceFormat, districtCode, now = new Date(), minProviders = 3 }) {
  const at = new Date(now).getTime();
  if (!Number.isFinite(at) || !Number.isInteger(minProviders) || minProviders < 2) reject('INVALID_REFERENCE_POLICY', 'นโยบายอ้างอิงราคาไม่ถูกต้อง');
  const eligible = rateCards.filter((card) => card.category === category && card.service_format === serviceFormat &&
    card.district_code === districtCode && card.status === 'ACTIVE' && Boolean(card.usage_grant_ref) &&
    card.provider_id === card.provider?.id &&
    Boolean(card.approved_by_user_id) && Number.isInteger(Number(card.amount_minor)) && Number(card.amount_minor) > 0 &&
    Date.parse(card.published_at ?? '') <= at && Date.parse(card.valid_until ?? '') > at &&
    verifiedTechnicianIsEligible({ provider: card.provider, verification: card.verification, now }));
  const latestByProvider = new Map();
  for (const card of eligible) {
    const prior = latestByProvider.get(card.provider_id);
    if (!prior || Date.parse(card.published_at) > Date.parse(prior.published_at)) latestByProvider.set(card.provider_id, card);
  }
  const fresh = [...latestByProvider.values()];
  if (fresh.length < minProviders) reject('INSUFFICIENT_PRICE_COVERAGE', 'ราคาอ้างอิงในพื้นที่ยังไม่เพียงพอ');
  const amounts = fresh.map((card) => Number(card.amount_minor)).sort((a, b) => a - b);
  return {
    referenceType: 'FIXTECH_NETWORK', sampleCount: amounts.length,
    lowMinor: amounts[0], highMinor: amounts[amounts.length - 1],
    observedAt: new Date(Math.max(...fresh.map((card) => Date.parse(card.published_at)))).toISOString(),
    validUntil: new Date(Math.min(...fresh.map((card) => Date.parse(card.valid_until)))).toISOString(),
    providerIds: fresh.map((card) => card.provider_id).sort()
  };
}
