-- Which modules are switched on. No rows means a fresh install; a disabled module keeps its tables.
create table module_state (
  name text primary key,
  enabled boolean not null,
  position integer not null,
  changed_at timestamptz(3) not null default now()
);
