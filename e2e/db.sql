-- The end-to-end database server: the runtime role, and one fresh database per shop in compose.yaml.
create role aicommerce_app with login password 'aicommerce_app';
select format('create database shop%s', n) from generate_series(0, 14) as n \gexec
