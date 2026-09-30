// Test-mode only. Confirm account capabilities and contractual payment flow before live use.
const API_ORIGIN = 'https://api.omise.co';

export function createOpnTestGateway({ secretKey, returnUri, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (typeof secretKey !== 'string' || !secretKey.startsWith('skey_test_')) {
    throw new Error('An Opn test secret key is required; live keys are not accepted by this adapter');
  }
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new TypeError('Invalid Opn adapter configuration');
  }
  let configuredReturnUri;
  try { configuredReturnUri = new URL(returnUri); } catch { throw new TypeError('A fixed HTTPS return URI is required'); }
  if (configuredReturnUri.protocol !== 'https:' || configuredReturnUri.username || configuredReturnUri.password || configuredReturnUri.hash) {
    throw new TypeError('A fixed HTTPS return URI is required');
  }
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  async function request(path, options = {}) {
    const response = await fetchImpl(`${API_ORIGIN}${path}`, {
      ...options,
      headers: { Authorization: authorization, Accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Opn test API request failed (${response.status})`);
    const result = await response.json();
    if (result?.object !== 'charge' || typeof result.id !== 'string' || result.livemode !== false) {
      throw new Error('Opn test API returned an unexpected charge');
    }
    return result;
  }
  return Object.freeze({
    name: 'opn',
    async createCharge({ amountMinor }) {
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new TypeError('Invalid charge amount');
      const form = new URLSearchParams({ amount: String(amountMinor), currency: 'THB', return_uri: configuredReturnUri.href, 'source[type]': 'grabpay' });
      return request('/charges', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    },
    async retrieveCharge(chargeId) {
      if (typeof chargeId !== 'string' || !/^chrg_test_[A-Za-z0-9]+$/.test(chargeId)) throw new TypeError('Invalid test charge ID');
      return request(`/charges/${chargeId}`);
    }
  });
}
