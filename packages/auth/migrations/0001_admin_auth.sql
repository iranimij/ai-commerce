-- Admin accounts, written to match Better Auth 1.7.25 (getSchema with the table names below).
-- customer_* stays free for storefront accounts (M2).
create table admin_user (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  two_factor_enabled boolean not null default false,
  disabled boolean not null default false
);

create table admin_session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id text not null references admin_user (id) on delete cascade
);
create index admin_session_user on admin_session (user_id);

create table admin_account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references admin_user (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index admin_account_user on admin_account (user_id);

create table admin_verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index admin_verification_identifier on admin_verification (identifier);

create table admin_two_factor (
  id text primary key,
  secret text not null,
  backup_codes text not null,
  user_id text not null references admin_user (id) on delete cascade,
  verified boolean default true,
  failed_verification_count integer default 0,
  locked_until timestamptz
);
create index admin_two_factor_user on admin_two_factor (user_id);
create index admin_two_factor_secret on admin_two_factor (secret);

create table admin_role (
  id text primary key,
  name text not null,
  permissions jsonb not null,
  system boolean not null default false,
  created_at timestamptz not null default now()
);

create table admin_user_role (
  user_id text not null references admin_user (id) on delete cascade,
  role_id text not null references admin_role (id),
  primary key (user_id, role_id)
);
create index admin_user_role_role on admin_user_role (role_id);

insert into admin_role (id, name, permissions, system) values ('owner', 'Owner', '["*"]', true);
