-- The live path of each active product and visible category, kept in step by wraps on the
-- catalog's writes. One table for both, so a product and a category can never share a path.
create table seo_path (
  path text primary key,
  -- null: the record's own slug, for every language. Translated paths arrive with languages (M6).
  locale text,
  kind text not null,
  record_id uuid not null
);

create index seo_path_record_id on seo_path (record_id);

create table seo_redirect (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  "from" text not null,
  "to" text not null,
  status integer not null,
  auto boolean not null,
  constraint seo_redirect_from_key unique ("from")
);

create index seo_redirect_list on seo_redirect (created_at, id);
-- Repointing the redirects into a path that moves.
create index seo_redirect_to on seo_redirect ("to");
