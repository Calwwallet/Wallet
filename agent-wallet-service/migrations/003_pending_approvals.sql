-- Migration: Add Human-in-the-Loop (HITL) Approval System
-- Enables pending transaction approvals requiring human authorization

BEGIN;

-- Pending approvals table - stores transactions requiring human approval
CREATE TABLE IF NOT EXISTS pending_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    from_address VARCHAR(255) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    value_eth VARCHAR(78) NOT NULL DEFAULT '0',
    value_usd DECIMAL(78, 2),
    chain VARCHAR(50) NOT NULL,
    token VARCHAR(50),
    data TEXT,
    method VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(255),
    rejected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    rejection_reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    CONSTRAINT chk_pending_approval_status 
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled'))
);

-- Index for wallet address queries
CREATE INDEX IF NOT EXISTS idx_pending_approvals_wallet 
    ON pending_approvals (wallet_address, status, created_at DESC);

-- Index for tenant isolation
CREATE INDEX IF NOT EXISTS idx_pending_approvals_tenant 
    ON pending_approvals (tenant_id, status, created_at DESC);

-- Index for expiration cleanup queries
CREATE INDEX IF NOT EXISTS idx_pending_approvals_expires 
    ON pending_approvals (status, expires_at) 
    WHERE status = 'pending';

-- Index for dashboard queries - recent pending
CREATE INDEX IF NOT EXISTS idx_pending_approvals_recent 
    ON pending_approvals (tenant_id, status, created_at DESC) 
    WHERE status = 'pending';

-- Comments
COMMENT ON TABLE pending_approvals IS 'Human-in-the-loop pending transaction approvals - prevents hallucinating agents from draining wallets';
COMMENT ON COLUMN pending_approvals.status IS 'Status: pending, approved, rejected, expired, cancelled';
COMMENT ON COLUMN pending_approvals.priority IS 'Priority: low, normal, high, urgent';
COMMENT ON COLUMN pending_approvals.value_usd IS 'USD value at time of submission for approval threshold checks';
COMMENT ON COLUMN pending_approvals.metadata IS 'Additional context: original request headers, agent info, context';

-- Policy enhancement: Add HITL fields to wallet_policies
ALTER TABLE wallet_policies 
    ADD COLUMN IF NOT EXISTS require_human_approval BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS approval_threshold_eth VARCHAR(78),
    ADD COLUMN IF NOT EXISTS approval_threshold_usd DECIMAL(78, 2),
    ADD COLUMN IF NOT EXISTS allowed_contracts TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS daily_limit_usd DECIMAL(78, 2),
    ADD COLUMN IF NOT EXISTS per_tx_limit_usd DECIMAL(78, 2);

COMMENT ON COLUMN wallet_policies.require_human_approval IS 'If true, transactions above threshold require human approval';
COMMENT ON COLUMN wallet_policies.approval_threshold_eth IS 'ETH value above which human approval is required';
COMMENT ON COLUMN wallet_policies.approval_threshold_usd IS 'USD value above which human approval is required';
COMMENT ON COLUMN wallet_policies.allowed_contracts IS 'Array of contract addresses this agent can interact with';
COMMENT ON COLUMN wallet_policies.daily_limit_usd IS 'Daily spending limit in USD';
COMMENT ON COLUMN wallet_policies.per_tx_limit_usd IS 'Per-transaction limit in USD';

-- Policy usage enhancement: Track USD spending
ALTER TABLE wallet_policy_usage 
    ADD COLUMN IF NOT EXISTS daily_usd JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN wallet_policy_usage.daily_usd IS 'Daily USD spending tracked for policy enforcement';

COMMIT;
