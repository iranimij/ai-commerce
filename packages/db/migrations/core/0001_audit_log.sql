-- Every call to every action, whatever its outcome. Rows can be added, never changed.
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_type text not null,
  actor_id text,
  on_behalf_of text,
  action text not null,
  input jsonb not null,
  outcome text not null,
  duration_ms integer not null
);

create index audit_log_at on audit_log (at);
create index audit_log_actor on audit_log (actor_type, actor_id);
create index audit_log_action on audit_log (action);

create function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_change
  before update or delete on audit_log
  for each row execute function audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_append_only();
