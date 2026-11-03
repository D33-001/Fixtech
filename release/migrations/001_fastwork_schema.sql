-- Migration: 001_fastwork_schema.sql
-- Upgrades FixTech schema to Fastwork Marketplace & Escrow Model

BEGIN;

-- 1. Update users table with ID card, banking, and suspension fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_number varchar(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_number varchar(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_name varchar(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason varchar(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by_admin_id uuid REFERENCES users(id);

-- 2. Update provider_profiles table with KYC and payout details
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS id_card_number varchar(20);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS id_card_image_url varchar(500);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS selfie_image_url varchar(500);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS bank_name varchar(100);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS bank_account_number varchar(50);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS bank_account_name varchar(150);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS skills_summary text;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS kyc_status varchar(30) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS kyc_rejection_reason varchar(500);
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS kyc_submitted_at timestamptz;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS kyc_reviewed_at timestamptz;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS kyc_reviewed_by_admin_id uuid REFERENCES users(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'provider_profiles_kyc_status_check'
    ) THEN
        ALTER TABLE provider_profiles ADD CONSTRAINT provider_profiles_kyc_status_check
            CHECK (kyc_status IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'));
    END IF;
END $$;

-- 3. Update jobs table with device details, specific symptoms, admin visibility, and AI checklist
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS device_type varchar(30);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS device_brand_or_model varchar(150);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS power_fan_beep_status text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screen_cable_status text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pre_incident_event text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS battery_charging_status text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS chassis_screen_keyboard_status text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS damage_history text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS other_symptoms text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden_reason varchar(500);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden_by_admin_id uuid REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_draft_checklist jsonb;

-- 4. Update offers table with Fastwork quotation fields
ALTER TABLE offers ADD COLUMN IF NOT EXISTS labor_fee numeric(12,2) CHECK (labor_fee IS NULL OR labor_fee >= 0);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS transport_fee numeric(12,2) CHECK (transport_fee IS NULL OR transport_fee >= 0);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS items_detail jsonb;

-- 5. Create job_work_proofs (หลักฐานก่อนและหลังทำงาน)
CREATE TABLE IF NOT EXISTS job_work_proofs (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    provider_id uuid NOT NULL REFERENCES provider_profiles(id),
    proof_type varchar(20) NOT NULL CHECK (proof_type IN ('BEFORE_WORK', 'AFTER_WORK')),
    image_url varchar(500) NOT NULL,
    original_filename varchar(255),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_work_proofs_job_proof_type_idx ON job_work_proofs(job_id, proof_type);

-- 6. Create escrow_payments (ระบบพักเงิน, โอนให้ช่าง, คืนเงิน)
CREATE TABLE IF NOT EXISTS escrow_payments (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    customer_user_id uuid NOT NULL REFERENCES users(id),
    provider_id uuid REFERENCES provider_profiles(id),
    total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
    platform_fee_percent numeric(5,2) NOT NULL DEFAULT 10.00,
    platform_fee numeric(12,2) NOT NULL DEFAULT 0.00,
    net_provider_amount numeric(12,2) NOT NULL CHECK (net_provider_amount >= 0),
    currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    status varchar(30) NOT NULL DEFAULT 'HOLDING' CHECK (status IN (
        'HOLDING', 'PENDING_PAYOUT', 'TRANSFERRED', 'DISPUTED_HOLD', 'REFUNDED_FULL', 'REFUNDED_PARTIAL'
    )),
    transfer_slip_url varchar(500),
    transferred_at timestamptz,
    transferred_by_admin_id uuid REFERENCES users(id),
    refund_amount numeric(12,2),
    refund_reason varchar(500),
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS escrow_payments_job_status_idx ON escrow_payments(job_id, status);

-- 7. Create user_reports (รายงานผู้ใช้ & ติดต่อเจ้าหน้าที่ จากแชต)
CREATE TABLE IF NOT EXISTS user_reports (
    id uuid PRIMARY KEY,
    reporter_user_id uuid NOT NULL REFERENCES users(id),
    reported_user_id uuid REFERENCES users(id),
    job_id uuid REFERENCES jobs(id),
    report_type varchar(30) NOT NULL CHECK (report_type IN ('USER_REPORT', 'CONTACT_ADMIN')),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    status varchar(30) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'INVESTIGATING', 'ACTION_TAKEN', 'CLOSED')),
    admin_notes text,
    admin_response text,
    resolved_by_admin_user_id uuid REFERENCES users(id),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_reports_status_created_idx ON user_reports(status, created_at DESC);

-- 8. Create system_settings (การตั้งค่าระบบ)
CREATE TABLE IF NOT EXISTS system_settings (
    key varchar(50) PRIMARY KEY,
    value jsonb NOT NULL,
    description varchar(255),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_admin_user_id uuid REFERENCES users(id)
);

-- Seed initial system_settings if empty
INSERT INTO system_settings(key, value, description)
VALUES 
    ('platform_fee_percent', '{"percent": 10.0}'::jsonb, 'อัตราค่าธรรมเนียมแพลตฟอร์ม (%)'),
    ('system_announcement', '{"enabled": true, "message": "ยินดีต้อนรับสู่ Fixtech แพลตฟอร์มจับคู่งานซ่อมคอมและโน้ตบุ๊ก"}'::jsonb, 'ประกาศของระบบ'),
    ('pricing_reference', '{"status": "active", "updated_at": "2026-11-01"}'::jsonb, 'ราคาอ้างอิงกลาง')
ON CONFLICT (key) DO NOTHING;

-- Relax audit log constraint so admin can audit user, kyc, and settings actions
ALTER TABLE admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_check;

COMMIT;
