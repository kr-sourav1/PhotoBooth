-- Platform admin support. The product operator (you) is a special account that owns NO studio
-- and is identified by the PLATFORM_ADMIN_EMAILS allowlist in the `admin` edge function. Here we
-- only make sure the signup trigger does NOT create a studio/owner row for an account flagged
-- platform_admin in its metadata.
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
  -- Platform admin: no studio, no users row. They exist only in auth.users.
  if coalesce(new.raw_user_meta_data->>'platform_admin', '') = 'true' then
    return new;
  end if;

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
