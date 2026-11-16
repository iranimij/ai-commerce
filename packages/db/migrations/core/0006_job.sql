-- Background jobs. A worker claims due pending jobs with `for update skip locked`.
create table job (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payload jsonb not null,
  key text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null,
  timeout_seconds integer not null,
  run_at timestamptz(3) not null default now(),
  locked_at timestamptz(3),
  locked_by text,
  last_error text,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  done_at timestamptz(3)
);

-- One active job per name and key.
create unique index job_active_key on job (name, key) where status in ('pending', 'running');
create index job_due on job (run_at) where status = 'pending';
create index job_newest on job (created_at desc, id desc);
