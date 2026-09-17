begin;
alter table private.ceo_access add column require_mfa boolean not null default false;
-- An enrolled verified factor must not be bypassable through a direct Data API request.
create or replace function private.is_ceo() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.ceo_access c where c.user_id=auth.uid() and c.enabled
 and ((not c.require_mfa and not exists(select 1 from auth.mfa_factors f where f.user_id=c.user_id and f.status='verified')) or auth.jwt()->>'aal'='aal2'));
$$;
revoke all on function private.is_ceo() from public,anon;
grant execute on function private.is_ceo() to authenticated;
commit;
