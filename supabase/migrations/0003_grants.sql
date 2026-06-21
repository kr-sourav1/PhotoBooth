-- Table/function privileges for the standard Supabase roles. RLS (from 0001) remains the
-- row-level security boundary; these are the coarse grants that must sit beneath it (a role needs
-- both the GRANT and a passing RLS policy to touch a row).
--
-- anon gets NO direct table access on purpose: anonymous gallery traffic goes through Edge
-- Functions using the service role, never straight to the tables.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

grant execute on all functions in schema public to authenticated, service_role;

-- Same grants for any tables/functions added later.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
