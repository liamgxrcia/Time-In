begin;

-- Google credentials are encrypted by the server before storage. They must never
-- be readable through the authenticated PostgREST surface or crm_snapshot().
alter table public.integration_connections
  add column provider_account_email text,
  add column scopes text[] not null default '{}',
  add column access_token_ciphertext text,
  add column refresh_token_ciphertext text,
  add column token_expires_at timestamptz;

create unique index integration_connections_owner_provider_uidx
  on public.integration_connections(owner_id, provider)
  where archived_at is null;

revoke select on public.integration_connections from authenticated;
grant select (
  id, owner_id, created_at, updated_at, revision, archived_at,
  provider, health, last_sync, error_category
) on public.integration_connections to authenticated;

create or replace function public.crm_snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid;
  result jsonb;
begin
  u:=private.require_ceo();
  select jsonb_build_object(
    'people',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.people where owner_id=u order by id limit 2001) r),
    'lead_profiles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.lead_profiles where owner_id=u order by id limit 2001) r),
    'organizations',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.organizations where owner_id=u order by id limit 2001) r),
    'onboarding_cases',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.onboarding_cases where owner_id=u order by id limit 2001) r),
    'client_accounts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.client_accounts where owner_id=u order by id limit 2001) r),
    'activities',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.activities where owner_id=u order by id limit 2001) r),
    'tasks',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.tasks where owner_id=u order by id limit 2001) r),
    'scripts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.scripts where owner_id=u order by id limit 2001) r),
    'script_versions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.script_versions where owner_id=u order by id limit 2001) r),
    'referrals',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.referrals where owner_id=u order by id limit 2001) r),
    'file_agreements',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.file_agreements where owner_id=u order by id limit 2001) r),
    'audit_events',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.audit_events where owner_id=u order by id limit 2001) r),
    'relationship_edges',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.relationship_edges where owner_id=u order by id limit 2001) r),
    'integration_connections',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,
      'owner_id',r.owner_id,
      'created_at',r.created_at,
      'updated_at',r.updated_at,
      'revision',r.revision,
      'archived_at',r.archived_at,
      'provider',r.provider,
      'health',r.health,
      'last_sync',r.last_sync,
      'error_category',r.error_category
    )),'[]'::jsonb) from (select * from public.integration_connections where owner_id=u and archived_at is null order by id limit 2001) r),
    'import_batches',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.import_batches where owner_id=u order by id limit 2001) r),
    'lifecycle_history',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.lifecycle_history where owner_id=u order by id limit 2001) r),
    'notification_preferences',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.notification_preferences where owner_id=u order by id limit 2001) r)
  ) into result;
  return result;
end;
$$;

commit;
