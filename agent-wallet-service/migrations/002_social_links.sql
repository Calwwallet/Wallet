-- Migration: Add Social Identity Support
-- Enables linking AI agents to owners' social media accounts

-- Social links table
CREATE TABLE IF NOT EXISTS social_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    username VARCHAR(255) NOT NULL,
    platform_user_id VARCHAR(255),
    profile_url TEXT,
    verification_method VARCHAR(50) DEFAULT 'self_claim',
    verified BOOLEAN DEFAULT false,
    tenant_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_id, platform, platform_user_id)
);

-- Index for platform lookups
CREATE INDEX IF NOT EXISTS idx_social_links_platform ON social_links(platform, platform_user_id);

-- Index for agent lookups
CREATE INDEX IF NOT EXISTS idx_social_links_agent ON social_links(agent_id);

-- Index for tenant isolation
CREATE INDEX IF NOT EXISTS idx_social_links_tenant ON social_links(tenant_id);

-- Add social links to agent_identities view
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS owner_wallet_address VARCHAR(42);

-- Activity log table for agent explorer
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    tenant_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    tx_hash VARCHAR(66),
    chain VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for agent activity queries
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity_log(agent_id, created_at DESC);

-- Index for tenant activity queries
CREATE INDEX IF NOT EXISTS idx_agent_activity_tenant ON agent_activity_log(tenant_id, created_at DESC);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_agent_activity_type ON agent_activity_log(event_type, created_at DESC);

-- Function to log agent activity
CREATE OR REPLACE FUNCTION log_agent_activity(
    p_agent_id UUID,
    p_event_type VARCHAR,
    p_event_data JSONB DEFAULT '{}',
    p_metadata JSONB DEFAULT '{}',
    p_tenant_id VARCHAR DEFAULT NULL,
    p_tx_hash VARCHAR DEFAULT NULL,
    p_chain VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_activity_id UUID;
BEGIN
    INSERT INTO agent_activity_log (agent_id, tenant_id, event_type, event_data, metadata, tx_hash, chain)
    VALUES (p_agent_id, p_tenant_id, p_event_type, p_event_data, p_metadata, p_tx_hash, p_chain)
    RETURNING id INTO v_activity_id;
    
    RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON TABLE social_links IS 'Links ERC-8004 AI agents to social media accounts';
COMMENT ON TABLE agent_activity_log IS 'Complete activity history for AI agents - used by Agent Explorer';
COMMENT ON COLUMN social_links.platform IS 'Social platform: twitter, github, discord, telegram, email, website';
COMMENT ON COLUMN social_links.verification_method IS 'How the link was verified: none, self_claim, oauth, proof';
COMMENT ON COLUMN agent_activity_log.event_type IS 'Event type: tx_sent, tx_confirmed, tx_failed, defi_swap, defi_stake, identity_created, policy_updated, etc.';
