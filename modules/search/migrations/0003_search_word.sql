-- Every word of every product name, unaccented and lower-cased (the `simple` lexemes of
-- search_document.suggest). Suggestions correct a typed word to its nearest known word here first,
-- so the nearest-first scan of search_document starts from a close match and stops early
-- (docs/benchmarks/m1a.md). Words are added with documents and never removed: a stale word only
-- costs a lookup that finds no product.
create table search_word (word text primary key);

create index search_word_trgm on search_word using gist (word public.gist_trgm_ops);

insert into search_word (word)
select distinct w.lexeme from search_document d, unnest(to_tsvector('simple', d.suggest)) w
on conflict do nothing;
