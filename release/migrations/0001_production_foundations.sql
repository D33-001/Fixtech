-- Apply once to a backed-up Fixtech v1.8 database after checking the target.
-- This migration prepares production records; it does not enable real payments.
BEGIN;

CREATE TABLE schema_migrations (
    version varchar(80) PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_verification_cases (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    initiated_by_user_id uuid NOT NULL REFERENCES users(id),
    vendor varchar(60) NOT NULL,
    external_case_ref varchar(160),
    status varchar(24) NOT NULL CHECK (status IN ('PENDING','IN_REVIEW','VERIFIED','REJECTED','EXPIRED')),
    decision_by_user_id uuid REFERENCES users(id),
    decision_reason varchar(500),
    requested_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    expires_at timestamptz,
    UNIQUE (vendor,external_case_ref),
    CHECK ((status IN ('VERIFIED','REJECTED') AND decision_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
       OR (status NOT IN ('VERIFIED','REJECTED') AND decision_by_user_id IS NULL AND decided_at IS NULL)),
    CHECK (status <> 'VERIFIED' OR (expires_at IS NOT NULL AND expires_at > decided_at))
);
CREATE INDEX provider_verification_cases_provider_recent ON provider_verification_cases(provider_id, requested_at DESC);

CREATE TABLE provider_verification_events (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES provider_verification_cases(id),
    actor_user_id uuid REFERENCES users(id),
    event_type varchar(40) NOT NULL,
    result_code varchar(80),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_verification_events_case_time ON provider_verification_events(case_id, occurred_at);

CREATE TABLE provider_rate_cards (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    district_code varchar(30) NOT NULL REFERENCES districts(code),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    scope_summary varchar(500) NOT NULL,
    usage_grant_ref varchar(160) NOT NULL,
    status varchar(20) NOT NULL CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
    approved_by_user_id uuid REFERENCES users(id),
    published_at timestamptz,
    valid_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category,service_format) REFERENCES service_catalog(category,service_format),
    CHECK (status <> 'ACTIVE' OR (approved_by_user_id IS NOT NULL AND published_at IS NOT NULL
        AND valid_until IS NOT NULL AND valid_until > published_at))
);
CREATE UNIQUE INDEX provider_rate_cards_one_active ON provider_rate_cards(provider_id,category,service_format,district_code) WHERE status='ACTIVE';
CREATE INDEX provider_rate_cards_current_lookup ON provider_rate_cards(category,service_format,district_code,valid_until) WHERE status='ACTIVE';

CREATE TABLE market_reference_snapshots (
    id uuid PRIMARY KEY,
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    district_code varchar(30) NOT NULL REFERENCES districts(code),
    reference_type varchar(24) NOT NULL CHECK (reference_type IN ('FIXTECH_NETWORK','LICENSED_EXTERNAL')),
    source_name varchar(160) NOT NULL,
    source_reference varchar(500) NOT NULL,
    usage_grant_ref varchar(160) NOT NULL,
    sample_count integer NOT NULL CHECK (sample_count > 0),
    low_minor bigint NOT NULL CHECK (low_minor > 0),
    high_minor bigint NOT NULL CHECK (high_minor >= low_minor),
    observed_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL CHECK (valid_until > observed_at),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category,service_format) REFERENCES service_catalog(category,service_format)
);
CREATE INDEX market_reference_current_lookup ON market_reference_snapshots(category,service_format,district_code,valid_until DESC);

CREATE TABLE payment_intents (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    customer_user_id uuid NOT NULL REFERENCES users(id),
    method varchar(12) NOT NULL CHECK (method IN ('GATEWAY','DIRECT')),
    status varchar(24) NOT NULL CHECK (status IN ('PENDING','AWAITING_CUSTOMER','PAID','FAILED','EXPIRED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    gateway_name varchar(60),
    gateway_charge_id varchar(160),
    idempotency_key varchar(120) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    UNIQUE (customer_user_id,idempotency_key),
    UNIQUE (gateway_name,gateway_charge_id),
    CHECK (method <> 'DIRECT' OR (gateway_name IS NULL AND gateway_charge_id IS NULL)),
    CHECK (method <> 'GATEWAY' OR gateway_name IS NOT NULL),
    CHECK (status NOT IN ('PAID','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED') OR paid_at IS NOT NULL)
);
CREATE INDEX payment_intents_job_recent ON payment_intents(job_id, created_at DESC);
CREATE UNIQUE INDEX payment_intents_one_open_gateway ON payment_intents(job_id) WHERE method='GATEWAY' AND status IN ('PENDING','AWAITING_CUSTOMER');

CREATE TABLE payment_webhook_events (
    id uuid PRIMARY KEY,
    payment_intent_id uuid REFERENCES payment_intents(id),
    gateway_name varchar(60) NOT NULL,
    external_event_id varchar(160) NOT NULL,
    gateway_charge_id varchar(160),
    event_type varchar(80) NOT NULL,
    payload_sha256 char(64) NOT NULL,
    processing_status varchar(20) NOT NULL CHECK (processing_status IN ('RECEIVED','PROCESSED','IGNORED','RETRY','REJECTED')),
    error_code varchar(80),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (gateway_name,external_event_id)
);
CREATE INDEX payment_webhook_events_retry ON payment_webhook_events(processing_status,received_at);

CREATE TABLE payment_refunds (
    id uuid PRIMARY KEY,
    payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
    requested_by_user_id uuid NOT NULL REFERENCES users(id),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    status varchar(20) NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','FAILED')),
    gateway_refund_id varchar(160) UNIQUE,
    reason varchar(500) NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
CREATE INDEX payment_refunds_intent ON payment_refunds(payment_intent_id,requested_at DESC);

INSERT INTO schema_migrations(version) VALUES ('0001_production_foundations');
COMMIT;
