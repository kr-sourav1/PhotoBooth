-- LOCAL-DEV ONLY seed (runs on `supabase db reset` / `supabase start`).
-- Creates the Supabase Storage bucket + policies used by the local storage backend. Production
-- uses Cloudflare R2 instead, so none of this touches prod.
insert into storage.buckets (id, name, public) values ('previews', 'previews', true)
  on conflict (id) do update set public = true;

drop policy if exists previews_auth_write on storage.objects;
drop policy if exists previews_auth_update on storage.objects;
drop policy if exists previews_read on storage.objects;
create policy previews_auth_write on storage.objects for insert to authenticated with check (bucket_id = 'previews');
create policy previews_auth_update on storage.objects for update to authenticated using (bucket_id = 'previews');
create policy previews_read on storage.objects for select using (bucket_id = 'previews');
