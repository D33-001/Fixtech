-- Fixtech expanded demo v1.8: PostgreSQL DDL for drawDB import.
-- Import as PostgreSQL SQL. UUID values are supplied by the application.
-- This is a logical demo schema: cross-table role, state and timing rules are
-- enforced by the application/service layer as described in the SRS.

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    role varchar(30) NOT NULL CHECK (role IN ('CUSTOMER_GENERAL','CUSTOMER_BUSINESS','TECHNICIAN','ADMIN')),
    display_name varchar(100) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    company_name varchar(160) NOT NULL,
    contact_name varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_profiles (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id),
    display_name varchar(100) NOT NULL,
    priority integer NOT NULL DEFAULT 0 CHECK (priority >= 0),
    is_approved boolean NOT NULL DEFAULT false,
    is_available boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE districts (
    code varchar(30) PRIMARY KEY,
    name varchar(100) NOT NULL UNIQUE
);

CREATE TABLE service_catalog (
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    label varchar(120) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (category, service_format),
    -- Demo v1.8 enables only these two workflow pairs.
    CHECK ((category = 'SOFTWARE' AND service_format = 'ONLINE') OR
           (category = 'HARDWARE' AND service_format = 'ONSITE'))
);

CREATE TABLE provider_services (
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    PRIMARY KEY (provider_id, category, service_format),
    FOREIGN KEY (category, service_format) REFERENCES service_catalog(category, service_format)
);

CREATE TABLE provider_districts (
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    district_code varchar(30) NOT NULL REFERENCES districts(code),
    PRIMARY KEY (provider_id, district_code)
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    customer_user_id uuid NOT NULL REFERENCES users(id),
    district_code varchar(30) NOT NULL REFERENCES districts(code),
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    assigned_provider_id uuid REFERENCES provider_profiles(id),
    agreed_amount numeric(12,2) CHECK (agreed_amount IS NULL OR agreed_amount > 0),
    agreed_by_user_id uuid REFERENCES users(id),
    agreed_at timestamptz,
    status varchar(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT','READY_TO_PUBLISH','POSTED','MATCHED','WAITING_FOR_SELECTION',
        'ASSIGNED','NO_PROVIDER_FOUND','WAITING_FOR_APPOINTMENT','SCHEDULED',
        'IN_PROGRESS','WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED','DISPUTED','CANCELLED')),
    symptom_text text NOT NULL CHECK (length(trim(symptom_text)) BETWEEN 1 AND 1000),
    ai_summary text CHECK (ai_summary IS NULL OR length(ai_summary) <= 1000),
    manufacturer varchar(100),
    model varchar(100),
    preferred_time_note varchar(200),
    analysis_version integer NOT NULL DEFAULT 0 CHECK (analysis_version >= 0),
    confirmed_analysis_version integer CHECK (confirmed_analysis_version > 0),
    analyzed_at timestamptz,
    summary_confirmed_at timestamptz,
    cancel_reason varchar(500),
    completion_note varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    posted_at timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    FOREIGN KEY (category, service_format) REFERENCES service_catalog(category, service_format),
    CHECK (confirmed_analysis_version IS NULL OR confirmed_analysis_version <= analysis_version),
    CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL) OR
           (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancel_reason IS NULL)),
    CHECK ((agreed_amount IS NULL AND agreed_by_user_id IS NULL AND agreed_at IS NULL) OR
           (agreed_amount IS NOT NULL AND agreed_by_user_id IS NOT NULL AND agreed_at IS NOT NULL))
);

CREATE TABLE offers (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    scope_summary text NOT NULL,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    status varchar(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','SELECTED','NOT_SELECTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, provider_id)
);

CREATE TABLE job_status_events (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    from_status varchar(40),
    to_status varchar(40) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_status IS NULL OR from_status IN (
        'DRAFT','READY_TO_PUBLISH','POSTED','MATCHED','WAITING_FOR_SELECTION','ASSIGNED',
        'NO_PROVIDER_FOUND','WAITING_FOR_APPOINTMENT','SCHEDULED','IN_PROGRESS',
        'WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED','DISPUTED','CANCELLED')),
    CHECK (to_status IN (
        'DRAFT','READY_TO_PUBLISH','POSTED','MATCHED','WAITING_FOR_SELECTION','ASSIGNED',
        'NO_PROVIDER_FOUND','WAITING_FOR_APPOINTMENT','SCHEDULED','IN_PROGRESS',
        'WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED','DISPUTED','CANCELLED')),
    CHECK ((from_status IS NULL AND to_status = 'DRAFT') OR
           (from_status IS NOT NULL AND from_status <> to_status))
);

CREATE TABLE job_attachments (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
    storage_key varchar(500) NOT NULL UNIQUE,
    original_filename varchar(255) NOT NULL,
    mime_type varchar(30) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 char(64),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_consents (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    user_id uuid NOT NULL REFERENCES users(id),
    terms_version varchar(30) NOT NULL,
    data_scope jsonb NOT NULL,
    consented_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE TABLE ai_analysis_runs (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    consent_id uuid NOT NULL REFERENCES ai_consents(id),
    version integer NOT NULL CHECK (version > 0),
    provider_name varchar(80) NOT NULL,
    model_name varchar(120) NOT NULL,
    status varchar(20) NOT NULL CHECK (status IN ('SUCCEEDED','FAILED','INVALID_RESPONSE')),
    result_json jsonb,
    error_code varchar(60),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (job_id, version)
);

CREATE TABLE ai_run_attachments (
    analysis_run_id uuid NOT NULL REFERENCES ai_analysis_runs(id),
    attachment_id uuid NOT NULL REFERENCES job_attachments(id),
    PRIMARY KEY (analysis_run_id, attachment_id)
);

CREATE TABLE pricing_rule_sets (
    id uuid PRIMARY KEY,
    version integer NOT NULL UNIQUE CHECK (version > 0),
    rules_json jsonb NOT NULL,
    effective_at timestamptz NOT NULL,
    is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE price_estimates (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    version integer NOT NULL CHECK (version > 0),
    analysis_run_id uuid REFERENCES ai_analysis_runs(id),
    rule_set_id uuid NOT NULL REFERENCES pricing_rule_sets(id),
    category varchar(20) NOT NULL,
    service_format varchar(20) NOT NULL,
    source_name varchar(100),
    source_reference varchar(500),
    fetched_at timestamptz NOT NULL,
    source_updated_at timestamptz,
    source_snapshot jsonb NOT NULL,
    estimated_min numeric(12,2) CHECK (estimated_min > 0),
    estimated_max numeric(12,2) CHECK (estimated_max > 0),
    currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    status varchar(20) NOT NULL CHECK (status IN ('ESTIMATED','ACCEPTED','STALE','UNAVAILABLE','SUPERSEDED')),
    accepted_by_user_id uuid REFERENCES users(id),
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, version),
    FOREIGN KEY (category, service_format) REFERENCES service_catalog(category, service_format),
    CHECK ((estimated_min IS NULL AND estimated_max IS NULL) OR
           (estimated_min IS NOT NULL AND estimated_max IS NOT NULL AND estimated_min <= estimated_max)),
    CHECK ((accepted_by_user_id IS NULL) = (accepted_at IS NULL)),
    CHECK (status <> 'ACCEPTED' OR (accepted_at IS NOT NULL AND estimated_min IS NOT NULL)),
    CHECK ((status = 'UNAVAILABLE' AND estimated_min IS NULL AND estimated_max IS NULL) OR
           (status IN ('ESTIMATED','ACCEPTED','STALE','SUPERSEDED') AND
            estimated_min IS NOT NULL AND estimated_max IS NOT NULL AND
            source_name IS NOT NULL AND source_reference IS NOT NULL AND source_updated_at IS NOT NULL))
);

CREATE TABLE job_messages (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    sender_user_id uuid NOT NULL REFERENCES users(id),
    body varchar(2000) NOT NULL CHECK (length(trim(body)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    job_id uuid REFERENCES jobs(id),
    event_key varchar(160) NOT NULL,
    type varchar(50) NOT NULL,
    title varchar(160) NOT NULL,
    body varchar(500) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    UNIQUE (user_id, event_key)
);

CREATE TABLE appointments (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    proposed_by_user_id uuid NOT NULL REFERENCES users(id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status varchar(30) NOT NULL CHECK (status IN ('PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED','CANCELLED','COMPLETED')),
    customer_confirmed_at timestamptz,
    provider_confirmed_at timestamptz,
    supersedes_id uuid,
    cancelled_by_user_id uuid REFERENCES users(id),
    cancel_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, id),
    FOREIGN KEY (job_id, supersedes_id) REFERENCES appointments(job_id, id),
    CHECK (starts_at < ends_at),
    CHECK (status <> 'CONFIRMED' OR
           (customer_confirmed_at IS NOT NULL AND provider_confirmed_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED' AND cancelled_by_user_id IS NOT NULL AND cancel_reason IS NOT NULL) OR
           (status <> 'CANCELLED' AND cancelled_by_user_id IS NULL AND cancel_reason IS NULL))
);

CREATE TABLE payment_simulations (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    initiated_by_user_id uuid NOT NULL REFERENCES users(id),
    method varchar(30) NOT NULL CHECK (method IN ('PLATFORM_SIMULATED','DIRECT')),
    status varchar(40) NOT NULL CHECK (status IN ('PENDING','PLATFORM_SIMULATED_PAID','PROVIDER_CONFIRMED_DIRECT','FAILED')),
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    idempotency_key varchar(100) NOT NULL UNIQUE,
    confirmed_by_user_id uuid REFERENCES users(id),
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((confirmed_by_user_id IS NULL) = (confirmed_at IS NULL)),
    CHECK ((status <> 'PLATFORM_SIMULATED_PAID' OR method = 'PLATFORM_SIMULATED') AND
           (status <> 'PROVIDER_CONFIRMED_DIRECT' OR method = 'DIRECT'))
);

CREATE TABLE warranties (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    status varchar(20) NOT NULL CHECK (status IN ('NOT_APPLICABLE','ACTIVE','EXPIRED')),
    duration_days smallint CHECK (duration_days IN (7,14,30)),
    terms_snapshot jsonb NOT NULL,
    accepted_by_user_id uuid NOT NULL REFERENCES users(id),
    accepted_at timestamptz NOT NULL,
    starts_at timestamptz,
    ends_at timestamptz,
    CHECK ((status = 'NOT_APPLICABLE' AND duration_days IS NULL AND starts_at IS NULL AND ends_at IS NULL) OR
           (status IN ('ACTIVE','EXPIRED') AND duration_days IS NOT NULL AND starts_at IS NOT NULL AND ends_at > starts_at))
);

CREATE TABLE warranty_claims (
    id uuid PRIMARY KEY,
    warranty_id uuid NOT NULL REFERENCES warranties(id),
    opened_by_user_id uuid NOT NULL REFERENCES users(id),
    reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
    status varchar(20) NOT NULL CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','REJECTED','CLOSED')),
    resolution varchar(2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

CREATE TABLE reviews (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
    customer_user_id uuid NOT NULL REFERENCES users(id),
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment varchar(1000),
    is_visible boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    opened_by_user_id uuid NOT NULL REFERENCES users(id),
    type varchar(40) NOT NULL CHECK (type IN (
        'SERVICE_QUALITY','PRICE_OR_SCOPE','PAYMENT','WARRANTY','CANCELLATION','OTHER')),
    reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
    status varchar(20) NOT NULL CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','REJECTED','CLOSED')),
    resolved_by_admin_user_id uuid REFERENCES users(id),
    resolution varchar(2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK ((status IN ('RESOLVED','REJECTED','CLOSED') AND resolution IS NOT NULL AND resolved_at IS NOT NULL) OR
           (status IN ('OPEN','UNDER_REVIEW') AND resolved_at IS NULL))
);

CREATE TABLE dispute_evidence (
    dispute_id uuid NOT NULL REFERENCES disputes(id),
    attachment_id uuid NOT NULL REFERENCES job_attachments(id),
    added_by_user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dispute_id, attachment_id)
);

CREATE TABLE admin_audit_logs (
    id uuid PRIMARY KEY,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    job_id uuid REFERENCES jobs(id),
    dispute_id uuid REFERENCES disputes(id),
    action varchar(60) NOT NULL,
    reason varchar(1000) NOT NULL,
    before_state jsonb,
    after_state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (job_id IS NOT NULL OR dispute_id IS NOT NULL)
);

-- Constraints that express "at most one" in the ERD.
CREATE UNIQUE INDEX offers_one_selected_per_job ON offers(job_id) WHERE status = 'SELECTED';
CREATE UNIQUE INDEX price_estimates_one_accepted_per_job ON price_estimates(job_id) WHERE status = 'ACCEPTED';
CREATE UNIQUE INDEX appointments_one_active_per_job ON appointments(job_id)
    WHERE status IN ('PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED');
CREATE INDEX job_attachments_job_status_idx ON job_attachments(job_id, status);
CREATE INDEX ai_analysis_runs_job_version_idx ON ai_analysis_runs(job_id, version DESC);
CREATE INDEX price_estimates_job_version_idx ON price_estimates(job_id, version DESC);
CREATE INDEX job_messages_job_created_idx ON job_messages(job_id, created_at, id);
CREATE INDEX notifications_user_read_created_idx ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX appointments_provider_time_idx ON appointments(provider_id, starts_at, ends_at);
CREATE INDEX appointments_job_status_idx ON appointments(job_id, status);
CREATE INDEX payment_simulations_job_created_idx ON payment_simulations(job_id, created_at DESC);
CREATE INDEX warranty_claims_warranty_status_idx ON warranty_claims(warranty_id, status);
CREATE INDEX disputes_job_status_created_idx ON disputes(job_id, status, created_at DESC);
CREATE INDEX admin_audit_logs_dispute_created_idx ON admin_audit_logs(dispute_id, created_at DESC);
