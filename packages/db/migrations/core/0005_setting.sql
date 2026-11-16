-- Setting values. A secret has `encrypted` set and `value` null.
create table setting (
  key text not null,
  channel text,
  value jsonb,
  encrypted text,
  version integer not null default 1,
  updated_at timestamptz(3) not null default now()
);

create unique index setting_key_channel on setting (key, (coalesce(channel, '')));

-- Revisions also record settings, whose record id is the key, not a uuid.
alter table revision alter column record_id type text;
