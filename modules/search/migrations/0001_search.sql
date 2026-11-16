-- In `public`, once per database, so every schema (and each test schema) finds them there.
create extension if not exists pg_trgm schema public;
create extension if not exists unaccent schema public;

-- One row per product, kept in step with the catalog by the wraps in src/sync.ts. The benchmark
-- seed writes it with COPY: every column is plain data, nothing is computed by a trigger.
create table search_document (
  product_id uuid primary key,
  -- The product's: draft, active or archived. Only active rows are ever returned.
  status text not null,
  -- The product's own name, and its translated names by locale: {"fa": "..."}. For sorting.
  name text not null,
  names jsonb not null default '{}',
  -- The product's, for "newest".
  created_at timestamptz(3) not null,
  -- Names (weight A), SKUs and public attribute values (B), short descriptions (C) and
  -- descriptions (D), in every locale, unaccented, with the `english` configuration when the shop
  -- language is en and `simple` otherwise.
  tsv tsvector not null,
  -- Every name, unaccented, for suggestions and typos (pg_trgm).
  suggest text not null,
  -- The ids of the product's visible categories and of all their ancestors: ["<uuid>", ...].
  categories jsonb not null default '[]',
  -- Values of select and multiselect attributes, the enabled variants' options included:
  -- {"color": ["red", "blue"]}.
  facets jsonb not null default '{}',
  -- The lowest channel-free amount per currency, enabled variants included: {"EUR": 1900}.
  prices jsonb not null default '{}'
);

create index search_document_tsv on search_document using gin (tsv);
create index search_document_categories on search_document using gin (categories jsonb_path_ops);
create index search_document_facets on search_document using gin (facets jsonb_path_ops);
create index search_document_suggest on search_document using gist (suggest public.gist_trgm_ops);
create index search_document_newest on search_document (created_at, product_id);
