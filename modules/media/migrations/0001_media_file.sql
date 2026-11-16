create table media_media_file (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  filename text not null,
  content_type text not null,
  width integer not null,
  height integer not null,
  bytes integer not null,
  sha256 text not null unique,
  alt text
);

create index media_media_file_list on media_media_file (created_at, id);
