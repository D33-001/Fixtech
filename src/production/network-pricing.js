import { networkReference } from './policies.js';

// Reference prices cover only verified Fixtech providers who granted usage rights.
// They are not an external market index and must be labelled accordingly in the UI.
export async function getNetworkReference({ pool, category, serviceFormat, districtCode, now = new Date(), minProviders = 3 }) {
  const result = await pool.query(`
    SELECT r.id,r.provider_id,r.category,r.service_format,r.district_code,r.amount_minor,
           r.status,r.usage_grant_ref,r.approved_by_user_id,r.published_at,r.valid_until,
           p.id AS verified_provider_id,p.is_approved,p.is_available,
           v.provider_id AS verification_provider_id,v.status AS verification_status,v.expires_at AS verification_expires_at
      FROM provider_rate_cards r
      JOIN provider_profiles p ON p.id=r.provider_id
      LEFT JOIN LATERAL (
        SELECT provider_id,status,expires_at
          FROM provider_verification_cases
         WHERE provider_id=p.id
         ORDER BY requested_at DESC,id DESC LIMIT 1
      ) v ON true
     WHERE r.category=$1 AND r.service_format=$2 AND r.district_code=$3
       AND r.status='ACTIVE' AND r.published_at <= $4 AND r.valid_until > $4`,
    [category,serviceFormat,districtCode,now]
  );
  const rateCards = result.rows.map((row) => ({
    ...row,
    provider: { id: row.verified_provider_id, is_approved: row.is_approved, is_available: row.is_available },
    verification: { provider_id: row.verification_provider_id, status: row.verification_status, expires_at: row.verification_expires_at }
  }));
  return networkReference({ rateCards, category, serviceFormat, districtCode, now, minProviders });
}
