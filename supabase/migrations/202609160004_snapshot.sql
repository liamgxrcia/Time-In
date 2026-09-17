begin;
-- A single statement snapshot avoids inconsistent cross-table reads during concurrent commits.
create function public.crm_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; result jsonb; begin
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
 'integration_connections',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.integration_connections where owner_id=u order by id limit 2001) r),
 'import_batches',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.import_batches where owner_id=u order by id limit 2001) r),
 'lifecycle_history',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.lifecycle_history where owner_id=u order by id limit 2001) r),
 'notification_preferences',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public.notification_preferences where owner_id=u order by id limit 2001) r)
 ) into result;
 return result;
end; $$;
revoke all on function public.crm_snapshot() from public,anon;
grant execute on function public.crm_snapshot() to authenticated;
commit;
