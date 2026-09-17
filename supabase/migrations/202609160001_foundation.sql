-- CEO CRM foundation. Run through Supabase migrations; never through browser credentials.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create type public.lifecycle_stage as enum ('new','follow_up','pending_signup','active','paused','not_interested','closed');
create type public.action_type as enum ('call','message','meeting','review','onboarding');
create table private.ceo_access (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id),
  enabled boolean not null default true
);
create function private.is_ceo() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from private.ceo_access where user_id = auth.uid() and enabled);
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_ceo() to authenticated;
create function private.require_ceo() returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception using message='UNAUTHENTICATED', errcode='P0001'; end if;
 if not private.is_ceo() then raise exception using message='FORBIDDEN', errcode='P0001'; end if;
 return auth.uid();
end; $$;
create table private.rate_limits (key text primary key, window_start timestamptz not null, count integer not null);
create function private.consume_limit(p_key text, p_limit integer, p_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; begin
 insert into private.rate_limits(key,window_start,count) values (p_key,clock_timestamp(),1)
 on conflict(key) do update set
 count=case when private.rate_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then 1 else private.rate_limits.count+1 end,
 window_start=case when private.rate_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else private.rate_limits.window_start end
 returning count into n;
 return n<=p_limit;
end; $$;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), name text not null check(length(trim(name)) between 1 and 200), notes text not null default ''
);
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
create policy ceo_read on public.organizations for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
create index organizations_owner_idx on public.organizations(owner_id,created_at);

create table public.people (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), name text not null check(length(trim(name)) between 1 and 200), emails text[] not null default '{}', phones text[] not null default '{}',
 notes text not null default '', tags text[] not null default '{}', consent_note text not null default '', communication_restricted boolean not null default false,
 organization_id uuid, merged_into uuid,
 foreign key (owner_id,organization_id) references public.organizations(owner_id,id),
 foreign key (owner_id,merged_into) references public.people(owner_id,id), check(merged_into is distinct from id)
);
alter table public.people enable row level security;
alter table public.people force row level security;
create policy ceo_read on public.people for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.people from anon, authenticated;
grant select on public.people to authenticated;
create index people_owner_idx on public.people(owner_id,created_at);

create table public.lead_profiles (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, stage public.lifecycle_stage not null default 'new', priority text not null default 'normal' check(priority in ('low','normal','high')),
 next_action_type public.action_type, next_action_at timestamptz, last_contact_at timestamptz, stage_entered_at timestamptz not null default now(),
 conversation_outcome text, reason text,
 unique(owner_id,person_id), foreign key(owner_id,person_id) references public.people(owner_id,id) on delete cascade,
 check((next_action_type is null) = (next_action_at is null)),
 check(stage <> 'follow_up' or next_action_at is not null),
 check(stage <> 'pending_signup' or conversation_outcome is not null),
 check(stage not in ('paused','not_interested','closed') or (reason is not null and length(trim(reason)) > 0))
);
alter table public.lead_profiles enable row level security;
alter table public.lead_profiles force row level security;
create policy ceo_read on public.lead_profiles for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.lead_profiles from anon, authenticated;
grant select on public.lead_profiles to authenticated;
create index lead_profiles_owner_idx on public.lead_profiles(owner_id,created_at);

create table public.onboarding_cases (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, template_id uuid not null, template_version integer not null check(template_version>0),
 items jsonb not null default '[]' check(jsonb_typeof(items)='array'), blockers jsonb not null default '[]' check(jsonb_typeof(blockers)='array'),
 due_at timestamptz not null, decision text not null default 'pending' check(decision in ('pending','approved','rejected')),
 rationale text, decided_at timestamptz,
 foreign key(owner_id,person_id) references public.people(owner_id,id),
 check(decision='pending' or (decided_at is not null and rationale is not null and length(trim(rationale))>0))
);
alter table public.onboarding_cases enable row level security;
alter table public.onboarding_cases force row level security;
create policy ceo_read on public.onboarding_cases for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.onboarding_cases from anon, authenticated;
grant select on public.onboarding_cases to authenticated;
create index onboarding_cases_owner_idx on public.onboarding_cases(owner_id,created_at);

create table public.client_accounts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, approved_at timestamptz not null, review_at timestamptz, risks text[] not null default '{}', health_override jsonb,
 unique(owner_id,person_id), foreign key(owner_id,person_id) references public.people(owner_id,id)
);
alter table public.client_accounts enable row level security;
alter table public.client_accounts force row level security;
create policy ceo_read on public.client_accounts for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.client_accounts from anon, authenticated;
grant select on public.client_accounts to authenticated;
create index client_accounts_owner_idx on public.client_accounts(owner_id,created_at);

create table public.scripts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), name text not null check(length(trim(name))>0), stage public.lifecycle_stage not null, campaign text not null default ''
);
alter table public.scripts enable row level security;
alter table public.scripts force row level security;
create policy ceo_read on public.scripts for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.scripts from anon, authenticated;
grant select on public.scripts to authenticated;
create index scripts_owner_idx on public.scripts(owner_id,created_at);

create table public.script_versions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), script_id uuid not null, version integer not null check(version>0), content text not null check(length(trim(content))>0), disclosures text not null default '',
 change_note text not null check(length(trim(change_note))>0), effective_at timestamptz not null default now(),
 unique(owner_id,script_id,version), foreign key(owner_id,script_id) references public.scripts(owner_id,id)
);
alter table public.script_versions enable row level security;
alter table public.script_versions force row level security;
create policy ceo_read on public.script_versions for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.script_versions from anon, authenticated;
grant select on public.script_versions to authenticated;
create index script_versions_owner_idx on public.script_versions(owner_id,created_at);

create table public.activities (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, kind text not null check(kind in ('call','message','meeting','note','email','stage_change','onboarding','task_completion','referral','file','decision')),
 summary text not null default '', outcome text, script_version_id uuid,
 foreign key(owner_id,person_id) references public.people(owner_id,id), foreign key(owner_id,script_version_id) references public.script_versions(owner_id,id)
);
alter table public.activities enable row level security;
alter table public.activities force row level security;
create policy ceo_read on public.activities for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.activities from anon, authenticated;
grant select on public.activities to authenticated;
create index activities_owner_idx on public.activities(owner_id,created_at);

create table public.tasks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, title text not null check(length(trim(title))>0), due_at timestamptz not null,
 priority text not null default 'normal' check(priority in ('low','normal','high')), status text not null default 'open' check(status in ('open','completed','cancelled')),
 recurrence jsonb, completed_at timestamptz, evidence text,
 foreign key(owner_id,person_id) references public.people(owner_id,id),
 check(status<>'completed' or (completed_at is not null and evidence is not null and length(trim(evidence))>0)),
 check(recurrence is null or (recurrence->>'unit' in ('day','week','month') and (recurrence->>'interval')::integer between 1 and 365))
);
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
create policy ceo_read on public.tasks for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.tasks from anon, authenticated;
grant select on public.tasks to authenticated;
create index tasks_owner_idx on public.tasks(owner_id,created_at);

create table public.referrals (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), referrer_id uuid not null, person_id uuid not null, source_note text not null check(length(trim(source_note))>0),
 foreign key(owner_id,person_id) references public.people(owner_id,id), foreign key(owner_id,referrer_id) references public.people(owner_id,id), check(referrer_id<>person_id)
);
alter table public.referrals enable row level security;
alter table public.referrals force row level security;
create policy ceo_read on public.referrals for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;
create index referrals_owner_idx on public.referrals(owner_id,created_at);

create table public.file_agreements (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, display_name text not null check(length(trim(display_name)) between 1 and 255), storage_path text not null unique,
 mime_type text not null, size bigint not null check(size between 1 and 20971520), status text not null default 'pending' check(status in ('pending','available','archived')),
 expires_at timestamptz, foreign key(owner_id,person_id) references public.people(owner_id,id)
);
alter table public.file_agreements enable row level security;
alter table public.file_agreements force row level security;
create policy ceo_read on public.file_agreements for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.file_agreements from anon, authenticated;
grant select on public.file_agreements to authenticated;
create index file_agreements_owner_idx on public.file_agreements(owner_id,created_at);

create table public.relationship_edges (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), from_id uuid not null, to_id uuid not null, kind text not null check(kind in ('introduced_by','works_with','related_to')),
 explanation text not null check(length(trim(explanation))>0), foreign key(owner_id,from_id) references public.people(owner_id,id), foreign key(owner_id,to_id) references public.people(owner_id,id), check(from_id<>to_id)
);
alter table public.relationship_edges enable row level security;
alter table public.relationship_edges force row level security;
create policy ceo_read on public.relationship_edges for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.relationship_edges from anon, authenticated;
grant select on public.relationship_edges to authenticated;
create index relationship_edges_owner_idx on public.relationship_edges(owner_id,created_at);

create table public.integration_connections (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), provider text not null, health text not null default 'disconnected' check(health in ('disconnected','healthy','warning')), last_sync timestamptz, error_category text
);
alter table public.integration_connections enable row level security;
alter table public.integration_connections force row level security;
create policy ceo_read on public.integration_connections for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.integration_connections from anon, authenticated;
grant select on public.integration_connections to authenticated;
create index integration_connections_owner_idx on public.integration_connections(owner_id,created_at);

create table public.import_batches (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), status text not null default 'committed' check(status in ('committed','rolled_back')), manifest jsonb not null, row_count integer not null, rolled_back_at timestamptz
);
alter table public.import_batches enable row level security;
alter table public.import_batches force row level security;
create policy ceo_read on public.import_batches for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
create index import_batches_owner_idx on public.import_batches(owner_id,created_at);

create table public.lifecycle_history (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), person_id uuid not null, from_stage public.lifecycle_stage not null, to_stage public.lifecycle_stage not null, operation_id uuid not null, foreign key(owner_id,person_id) references public.people(owner_id,id)
);
alter table public.lifecycle_history enable row level security;
alter table public.lifecycle_history force row level security;
create policy ceo_read on public.lifecycle_history for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.lifecycle_history from anon, authenticated;
grant select on public.lifecycle_history to authenticated;
create index lifecycle_history_owner_idx on public.lifecycle_history(owner_id,created_at);

create table public.audit_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), target_id uuid, action text not null, operation_id uuid not null, metadata jsonb not null default '{}'
);
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
create policy ceo_read on public.audit_events for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
create index audit_events_owner_idx on public.audit_events(owner_id,created_at);

create table public.notification_preferences (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 0 check(revision>=0), archived_at timestamptz,
 unique(owner_id,id), email_enabled boolean not null default false, web_push_enabled boolean not null default false, unique(owner_id)
);
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
create policy ceo_read on public.notification_preferences for select to authenticated using (owner_id=(select auth.uid()) and (select private.is_ceo()));
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
create index notification_preferences_owner_idx on public.notification_preferences(owner_id,created_at);

create index lead_stage_idx on public.lead_profiles(owner_id,stage,next_action_at);
create index activities_person_idx on public.activities(owner_id,person_id,created_at desc);
create index tasks_due_idx on public.tasks(owner_id,status,due_at);
create index people_name_idx on public.people(owner_id,lower(name));
create table private.operations (
 owner_id uuid not null references auth.users(id), id uuid not null, payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(owner_id,id)
);
create function private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using message='IMMUTABLE_HISTORY',errcode='P0001'; end; $$;
create trigger audit_immutable before update or delete on public.audit_events for each row execute function private.immutable();
create trigger activity_immutable before update or delete on public.activities for each row execute function private.immutable();
create trigger history_immutable before update or delete on public.lifecycle_history for each row execute function private.immutable();
create trigger script_immutable before update or delete on public.script_versions for each row execute function private.immutable();
create function private.active_requires_approval() returns trigger language plpgsql set search_path='' as $$
begin
 if new.stage='active' and not exists(select 1 from public.onboarding_cases o where o.owner_id=new.owner_id and o.person_id=new.person_id and o.decision='approved') then
 raise exception using message='ONBOARDING_INCOMPLETE',errcode='P0001'; end if;
 return new;
end; $$;
create constraint trigger validate_active after insert or update on public.lead_profiles deferrable initially deferred for each row execute function private.active_requires_approval();
-- Explicitly private bucket. Browser writes/reads are denied; signed URLs are issued by authorized server routes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('agreements','agreements',false,20971520,array['application/pdf','image/png','image/jpeg','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_ceo() to authenticated;
commit;
