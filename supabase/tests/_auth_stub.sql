-- Local stand-in for Supabase's auth schema so migrations + RLS can be exercised against a plain
-- Postgres (no hosted Supabase needed). Real Supabase provides auth.users and a JWT-based
-- auth.uid(); here auth.uid() reads a session GUC so tests can impersonate users.
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

create extension if not exists pgcrypto;

-- A role RLS actually applies to (the postgres owner bypasses RLS, like the service role does).
drop role if exists app_user;
create role app_user nologin;
grant usage on schema public, auth to app_user;
grant execute on function auth.uid() to app_user;
