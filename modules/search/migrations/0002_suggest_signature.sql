-- At 1,000,000 products the default 12-byte trigram signature is so lossy that a nearest-first
-- scan for a suggestion reads most of the index before it can stop. 256 bytes keeps it precise for
-- names, for 7% more index (docs/benchmarks/m1a.md).
drop index search_document_suggest;
create index search_document_suggest on search_document
  using gist (suggest public.gist_trgm_ops(siglen = 256));
