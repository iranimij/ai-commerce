-- Shared request counters, one row per key and time window.
create table rate_limit (
  key text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (key, window_start)
);
