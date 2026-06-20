-- On studio sign-up, bootstrap a tenant: create a studio and the owner user row.
-- The new user becomes the 'owner' of a freshly created studio. Members are later invited
-- into an existing studio (that flow passes studio_id via user metadata and skips creation).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio_id uuid;
  v_studio_name text;
begin
  -- Invited members carry an existing studio_id in their metadata.
  v_studio_id := nullif(new.raw_user_meta_data->>'studio_id', '')::uuid;

  if v_studio_id is null then
    v_studio_name := coalesce(
      nullif(new.raw_user_meta_data->>'studio_name', ''),
      split_part(new.email, '@', 1) || '''s Studio'
    );
    insert into public.studios (name) values (v_studio_name)
      returning id into v_studio_id;

    insert into public.subscriptions (studio_id) values (v_studio_id);

    insert into public.users (id, studio_id, email, full_name, role)
      values (new.id, v_studio_id, new.email, new.raw_user_meta_data->>'full_name', 'owner');
  else
    insert into public.users (id, studio_id, email, full_name, role)
      values (new.id, v_studio_id, new.email, new.raw_user_meta_data->>'full_name', 'member');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
