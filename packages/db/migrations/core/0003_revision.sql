-- Every change to a resource record, with the record before and after it. Append-only.
create table revision (
  id bigserial primary key,
  resource text not null,
  record_id uuid not null,
  -- The record's version after the change; null for a delete.
  version integer,
  action text not null,
  actor_type text not null,
  actor_id text,
  on_behalf_of text,
  at timestamptz(3) not null default now(),
  before jsonb,
  after jsonb
);

create index revision_record on revision (resource, record_id, id desc);

create function revision_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'revision is append-only';
end;
$$;

create trigger revision_no_change
  before update or delete on revision
  for each row execute function revision_append_only();

create trigger revision_no_truncate
  before truncate on revision
  for each statement execute function revision_append_only();
