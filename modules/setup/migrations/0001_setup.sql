-- First-run setup. One row: the hash of the one-time token, the modules chosen, and when it ended.
create table setup_state (
  id boolean primary key default true check (id),
  token_hash text,
  modules text[],
  finished_at timestamptz(3)
);
insert into setup_state default values;
