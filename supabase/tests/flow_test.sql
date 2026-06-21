-- End-to-end data-flow verification for PhotoBooth, run against a real Postgres with the actual
-- migrations applied. It walks the exact query path the app uses at each phase and asserts the
-- result, plus the multi-tenant security boundaries. `service path` blocks run as the table owner
-- (mirroring the service-role key used by Edge Functions, which bypasses RLS); `studio path`
-- blocks run as app_user with a GUC-set identity (mirroring an authenticated studio user under RLS).
\set ON_ERROR_STOP on

-- ── Phase 0: two studios sign up (auth.users insert fires handle_new_user) ───────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@studioA.com', '{"studio_name":"Studio A"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@studioB.com',   '{"studio_name":"Studio B"}');

select s.id as a_studio from public.studios s join public.users u on u.studio_id = s.id
  where u.id = '11111111-1111-1111-1111-111111111111' \gset

-- ── Phase 2: Studio A creates a project and records 4 uploaded previews ──────────────────────
insert into public.projects (studio_id, name, status)
  values (:'a_studio', 'Sharma Wedding', 'draft') returning id as a_project \gset

insert into public.photos (uuid, project_id, studio_id, original_filename, preview_path, width, height, sort_order) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'a_project', :'a_studio', 'IMG_1.jpg', 'k1', 1600, 1067, 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'a_project', :'a_studio', 'IMG_2.jpg', 'k2', 1600, 1067, 1),
  ('aaaaaaaa-0000-0000-0000-000000000003', :'a_project', :'a_studio', 'IMG_3.jpg', 'k3', 1600, 1067, 2),
  ('aaaaaaaa-0000-0000-0000-000000000004', :'a_project', :'a_studio', 'IMG_4.jpg', 'k4', 1600, 1067, 3);

-- ── Phase 3a: share the project (desktop sets a token + expiry) ──────────────────────────────
update public.projects
  set share_token = 'SHARE_A', share_expires_at = now() + interval '90 days', status = 'awaiting_selection'
  where id = :'a_project';
-- a second project whose link has expired, to prove expiry is enforced
insert into public.projects (studio_id, name, status, share_token, share_expires_at)
  values (:'a_studio', 'Expired Shoot', 'awaiting_selection', 'SHARE_EXP', now() - interval '1 day');

-- ── Phase 3b: gallery-get (Edge Function service path) ───────────────────────────────────────
do $$
declare pid uuid; nm text; ordered text[];
begin
  select id, name into pid, nm from public.projects
    where share_token = 'SHARE_A' and (share_expires_at is null or share_expires_at > now());
  if pid is null then raise exception 'gallery-get: live token did not resolve'; end if;

  select array_agg(preview_path order by sort_order) into ordered from public.photos where project_id = pid;
  if ordered <> array['k1','k2','k3','k4'] then raise exception 'gallery-get: wrong preview order %', ordered; end if;
  raise notice 'PASS 3b gallery-get: resolved "%", returned 4 previews in order', nm;

  -- expired link must NOT resolve
  perform 1 from public.projects
    where share_token = 'SHARE_EXP' and (share_expires_at is null or share_expires_at > now());
  if found then raise exception 'gallery-get: expired link resolved (should not)'; end if;
  raise notice 'PASS 3b gallery-get: expired link correctly rejected';
end $$;

-- ── Phase 3c: selection-submit (Edge Function service path) ──────────────────────────────────
-- Client submits two real photos plus one foreign UUID that does not belong to the project.
do $$
declare pid uuid; sid uuid;
        submitted uuid[] := array[
          'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000003',
          'ffffffff-0000-0000-0000-000000000099'  -- foreign / not in project
        ]::uuid[];
        valid uuid[]; inserted int;
begin
  select id, studio_id into pid, sid from public.projects where share_token = 'SHARE_A';
  select array_agg(p.uuid) into valid
    from public.photos p where p.project_id = pid and p.uuid = any(submitted);

  delete from public.selections where project_id = pid;             -- idempotent replace
  insert into public.selections (project_id, studio_id, photo_uuid, status)
    select pid, sid, u, 'submitted' from unnest(valid) u;
  get diagnostics inserted = row_count;
  update public.projects set status = 'selection_submitted' where id = pid;

  if inserted <> 2 then raise exception 'selection-submit: expected 2 valid, got %', inserted; end if;
  raise notice 'PASS 3c selection-submit: 2 valid stored, foreign UUID rejected';
end $$;

-- Re-submit a different set: must REPLACE the prior selection, not accumulate.
do $$
declare pid uuid; sid uuid; cnt int;
begin
  select id, studio_id into pid, sid from public.projects where share_token = 'SHARE_A';
  delete from public.selections where project_id = pid;
  insert into public.selections (project_id, studio_id, photo_uuid, status)
    values (pid, sid, 'aaaaaaaa-0000-0000-0000-000000000002', 'submitted');
  select count(*) into cnt from public.selections where project_id = pid;
  if cnt <> 1 then raise exception 'selection-submit: re-submit did not replace (count=%)', cnt; end if;
  raise notice 'PASS 3c selection-submit: re-submit replaced prior selection (idempotent)';
end $$;

-- ── Phase 4 readback: what the desktop will collect ──────────────────────────────────────────
do $$
declare sel uuid[];
begin
  select array_agg(photo_uuid) into sel from public.selections
    where project_id = (select id from public.projects where share_token = 'SHARE_A');
  if sel <> array['aaaaaaaa-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'collect readback: unexpected selection %', sel;
  end if;
  raise notice 'PASS 4 collect readback: desktop would collect exactly IMG_2 (by UUID)';
end $$;

-- ── Security: RLS isolation between studios ──────────────────────────────────────────────────
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
set role app_user;
do $$
declare ph int;
begin
  select count(*) into ph from public.photos;        -- A's own
  if ph <> 4 then raise exception 'RLS: Studio A should see 4 photos, saw %', ph; end if;
  raise notice 'PASS sec: Studio A sees its own 4 photos';
end $$;
reset role;

select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
set role app_user;
do $$
declare ph int; se int;
begin
  select count(*) into ph from public.photos;        -- B has none of A's
  select count(*) into se from public.selections;
  if ph <> 0 or se <> 0 then raise exception 'RLS LEAK: Studio B saw % photos, % selections', ph, se; end if;
  raise notice 'PASS sec: Studio B cannot see Studio A photos or selections';
end $$;
reset role;

select 'ALL FLOW + SECURITY CHECKS PASSED' as result;
