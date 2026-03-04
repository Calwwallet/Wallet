-- 001_init.sql
-- Production-grade, multi-tenant schema (Postgres)

begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Tenant boundary
create table if not exists tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- API keys (store hash only)
create table if not exists api_keys (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  name text,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, key_prefix)
);

-- Wallets (public metadata)
create table if not exists wallets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  agent_name text,
  address text not null,
  chain text,
  imported boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, address)
);

-- Wallet secrets (encrypted key material + wrapped data key)
create table if not exists wallet_secrets (
  wallet_id text primary key references wallets(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  enc_private_key text not null,
  kms_key_id text,
  wrapped_data_key text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

-- Identities
create table if not exists identities (
  agent_id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  wallet_address text not null,
  type text,
  name text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, agent_id)
);

-- Policy engine data
create table if not exists wallet_policies (
  tenant_id text not null references tenants(id) on delete cascade,
  wallet_address text not null,
  policy jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, wallet_address)
);

create table if not exists wallet_policy_usage (
  tenant_id text not null references tenants(id) on delete cascade,
  wallet_address text not null,
  usage jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, wallet_address)
);

-- Tx intents: idempotency + state machine
create table if not exists tx_intents (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  idempotency_key text not null,
  from_address text not null,
  to_address text not null,
  value_eth text,
  chain text,
  status text not null,
  response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

-- Tx log
create table if not exists wallet_transactions (
  hash text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  from_address text not null,
  to_address text not null,
  value_eth text,
  timestamp timestamptz not null default now(),
  chain text,
  policy jsonb,
  meta jsonb
);

create index if not exists idx_wallet_transactions_tenant_ts
  on wallet_transactions (tenant_id, timestamp desc);
create index if not exists idx_wallets_tenant_address
  on wallets (tenant_id, address);
create index if not exists idx_api_keys_tenant_prefix
  on api_keys (tenant_id, key_prefix);
create index if not exists idx_tx_intents_tenant_key
  on tx_intents (tenant_id, idempotency_key);

-- ============================================================
-- Multi-Sig Wallet Tables
-- ============================================================

-- Multi-sig wallet configurations
create table if not exists multisig_wallets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  address text not null,
  chain text not null,
  threshold integer not null check (threshold >= 1),
  owner_count integer not null check (owner_count >= 1),
  owners jsonb not null default '[]'::jsonb,
  roles jsonb default '{}'::jsonb,
  timelock_seconds integer default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, address)
);

-- Multi-sig transaction intents
create table if not exists multisig_transactions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  multisig_address text not null,
  tx_index integer not null,
  to_address text not null,
  value_eth text default '0',
  data text default '0x',
  operation integer not null default 0,  -- 0=call, 1=delegatecall
  nonce text not null,
  description text,
  timelock_until timestamptz,
  executed_at timestamptz,
  executor_address text,
  tx_hash text,
  status text not null default 'pending',  -- pending, confirmed, executed, cancelled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, multisig_address, tx_index)
);

-- Multi-sig transaction confirmations
create table if not exists multisig_confirmations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  multisig_address text not null,
  tx_id text not null references multisig_transactions(id) on delete cascade,
  signer_address text not null,
  signature text,
  confirmed_at timestamptz not null default now(),
  unique (tenant_id, tx_id, signer_address)
);

-- Indexes for multi-sig tables
create index if not exists idx_multisig_wallets_tenant_address
  on multisig_wallets (tenant_id, address);
create index if not exists idx_multisig_transactions_multisig
  on multisig_transactions (tenant_id, multisig_address, status);
create index if not exists idx_multisig_confirmations_tx
  on multisig_confirmations (tenant_id, tx_id);

commit;

