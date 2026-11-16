create table sample_note (
  id uuid primary key,
  version integer not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  attributes jsonb not null default '{}',
  title text not null,
  body text,
  pinned boolean not null default false
);

create index sample_note_list on sample_note (created_at, id);
create index sample_note_attributes on sample_note using gin (attributes);
