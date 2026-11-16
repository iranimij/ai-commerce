create table catalog_category (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  name text not null,
  slug text not null,
  parent_id uuid,
  position integer not null,
  enabled boolean not null,
  description text,
  meta_title text,
  meta_description text,
  translations jsonb,
  constraint catalog_category_parent_id_slug_key unique nulls not distinct (parent_id, slug)
);

create index catalog_category_list on catalog_category (created_at, id);

create table catalog_attribute_set (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  name text not null unique,
  codes jsonb not null
);

create index catalog_attribute_set_list on catalog_attribute_set (created_at, id);

create table catalog_product (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  type text not null,
  sku text not null unique,
  name text not null,
  slug text not null unique,
  status text not null,
  short_description text,
  description text,
  prices jsonb not null,
  configurable_attributes jsonb,
  category_ids jsonb not null,
  media jsonb not null,
  links jsonb not null,
  attribute_set_id uuid,
  meta_title text,
  meta_description text,
  translations jsonb
);

create index catalog_product_list on catalog_product (created_at, id);
create index catalog_product_category_ids on catalog_product using gin (category_ids);
create index catalog_product_attributes on catalog_product using gin (attributes);

create table catalog_product_variant (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  product_id uuid not null,
  sku text not null unique,
  options jsonb not null,
  prices jsonb,
  media jsonb not null,
  enabled boolean not null,
  position integer not null,
  -- Also the index for a product's variants.
  constraint catalog_product_variant_product_id_options_key unique (product_id, options)
);

create index catalog_product_variant_list on catalog_product_variant (created_at, id);

-- One SKU across products and variants; `owner` is the product or variant holding it.
create table catalog_sku (
  sku text primary key,
  owner uuid not null
);

create index catalog_sku_owner on catalog_sku (owner);
