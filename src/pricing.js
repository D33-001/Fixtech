export const CURATED_REFERENCE_MAX_AGE_DAYS = 30;

export function referenceIsFresh(reference, now = Date.now(), liveMaxAgeHours = 24) {
  const curated = reference?.referenceType === 'CURATED_PUBLIC_EXAMPLES';
  const timestamp = Date.parse((curated ? reference?.reviewedAt : reference?.sourceUpdatedAt) ?? '');
  const maxAge = curated ? CURATED_REFERENCE_MAX_AGE_DAYS * 24 * 60 * 60_000 : Number(liveMaxAgeHours) * 60 * 60_000;
  return Number.isFinite(timestamp) && Number.isFinite(maxAge) && maxAge > 0 && timestamp <= now + 60_000 && now - timestamp <= maxAge;
}

export function estimatePrice({ rules, referenceLow, referenceHigh, districtCode, key, isBusiness }) {
  const labor = Number(rules.laborBase?.[key]);
  const referenceShare = Number(rules.marketShare);
  const districtFactor = Number(rules.districtFactors?.[districtCode]);
  const platformMarkupRate = Number(rules.platformMarkupRate);
  const complexityMultiplier = Number(rules.complexityMultiplier);
  const urgencyMultiplier = Number(rules.urgencyMultiplier);
  if (![labor, referenceShare, districtFactor, platformMarkupRate, complexityMultiplier, urgencyMultiplier].every(Number.isFinite) || labor < 0 || referenceShare < 0 || districtFactor <= 0 || platformMarkupRate < 0 || platformMarkupRate > 1 || complexityMultiplier !== 1 || urgencyMultiplier !== 1) {
    const error = new Error('PRICING_RULES_INVALID'); error.code = 'PRICING_RULES_INVALID'; throw error;
  }
  const round10 = (value) => Math.max(1, Math.round(value / 10) * 10);
  const calculate = (reference) => round10((labor + Number(reference) * referenceShare) * districtFactor * complexityMultiplier * urgencyMultiplier * (1 + platformMarkupRate));
  const min = calculate(referenceLow);
  return { min, max: isBusiness ? calculate(referenceHigh) : min };
}
