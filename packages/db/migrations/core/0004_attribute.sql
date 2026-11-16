-- Attributes merchants add to resources. Module attributes live in code, not here.
create table attribute (
  resource text not null,
  code text not null,
  label text not null,
  type text not null,
  options jsonb,
  required boolean not null default false,
  privacy text not null,
  created_at timestamptz not null default now(),
  primary key (resource, code)
);
