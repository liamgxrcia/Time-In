-- R1 contract closure. Additive upgrade; previous migrations remain unchanged.
begin;
alter table public.people add column source_note text not null default '',
 add column consent_recorded_at timestamptz,
 add column consent_recorded_by uuid references auth.users(id);
-- Existing notes have unknown capture dates: do not fabricate historical provenance.
alter table public.lifecycle_history add column reason text, add column next_action jsonb;
alter table public.import_batches add column results jsonb not null default '[]' check(jsonb_typeof(results)='array');
alter table public.lead_profiles add column next_action_owner_id uuid generated always as
 (case when next_action_at is not null then owner_id end) stored;
alter table public.lead_profiles add constraint next_action_owner_required
 check(stage <> 'follow_up' or next_action_owner_id is not null);
alter table public.tasks add constraint recurrence_complete check(recurrence is null or coalesce(
 jsonb_typeof(recurrence)='object' and recurrence->>'unit' in ('day','week','month') and
 jsonb_typeof(recurrence->'interval')='number' and (recurrence->>'interval')::numeric between 1 and 365 and
 (recurrence->>'interval')::numeric=trunc((recurrence->>'interval')::numeric),false));
create unique index onboarding_one_current on public.onboarding_cases(owner_id,person_id) where decision in ('pending','approved');
create function private.validate_r1_command(c jsonb,u uuid) returns void language plpgsql set search_path='' as $$
declare allowed text[]; r jsonb; begin
 allowed:=case c->>'type'
 when 'person.create' then string_to_array('type name emails phones notes consentNote organizationId source sourceNote communicationRestricted',' ')
 when 'person.update' then string_to_array('type id expectedRevision name emails phones notes consentNote sourceNote communicationRestricted',' ')
 when 'person.archive' then string_to_array('type id expectedRevision',' ')
 when 'person.merge' then string_to_array('type sourceId targetId sourceRevision expectedRevision',' ')
 when 'organization.create' then string_to_array('type name notes',' ')
 when 'organization.update' then string_to_array('type id expectedRevision name notes',' ')
 when 'lifecycle.transition' then string_to_array('type id expectedRevision stage nextAction reason',' ')
 when 'next_action.schedule' then string_to_array('type id expectedRevision nextAction',' ')
 when 'activity.create' then string_to_array('type personId kind summary outcome nextAction scriptVersionId',' ')
 when 'onboarding.start' then string_to_array('type personId dueAt templateId templateVersion items blockers',' ')
 when 'onboarding.item' then string_to_array('type id expectedRevision itemId waiverReason',' ')
 when 'onboarding.decide' then string_to_array('type id expectedRevision approve rationale',' ')
 when 'task.create' then string_to_array('type personId title dueAt priority recurrence',' ')
 when 'task.complete' then string_to_array('type id expectedRevision evidence',' ')
 when 'task.snooze' then string_to_array('type id expectedRevision dueAt',' ')
 when 'task.cancel' then string_to_array('type id expectedRevision reason',' ')
 when 'script.publish' then string_to_array('type scriptId expectedVersion name stage content disclosures changeNote',' ')
 when 'referral.create' then string_to_array('type referrerId personId sourceNote',' ')
 when 'relationship.create' then string_to_array('type fromId toId kind explanation',' ')
 when 'client.review' then string_to_array('type personId expectedRevision reviewAt risks',' ')
 when 'import.commit' then string_to_array('type rows',' ')
 when 'import.rollback' then string_to_array('type id',' ')
 when 'notification.preferences' then string_to_array('type expectedRevision emailEnabled webPushEnabled',' ')
 when 'file.register' then string_to_array('type personId displayName mimeType size expiresAt',' ')
 when 'file.finalize' then string_to_array('type id expectedRevision',' ')
 when 'security.event' then string_to_array('type event targetId',' ')
 else null end;
 if allowed is null or exists(select 1 from jsonb_object_keys(c) k where not k=any(allowed)) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if c ? 'nextAction' then
  if jsonb_typeof(c->'nextAction')<>'object' or exists(select 1 from jsonb_object_keys(c->'nextAction') k where k not in ('type','dueAt','ownerId')) then raise exception using message='VALIDATION',errcode='P0001'; end if;
  if c->'nextAction' ? 'ownerId' and (c->'nextAction'->>'ownerId')::uuid is distinct from u then raise exception using message='FORBIDDEN',errcode='P0001'; end if;
 end if;
 if c ? 'recurrence' and (jsonb_typeof(c->'recurrence')<>'object' or exists(select 1 from jsonb_object_keys(c->'recurrence') k where k not in ('unit','interval'))) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if c->>'type'='onboarding.start' then
  for r in select * from jsonb_array_elements(c->'items') loop
   if exists(select 1 from jsonb_object_keys(r) k where k not in ('title','required')) or coalesce(length(trim(r->>'title')),0) not between 1 and 200 or jsonb_typeof(r->'required') is distinct from 'boolean' then raise exception using message='VALIDATION',errcode='P0001'; end if;
  end loop;
 end if;
 if c->>'type'='person.create' and c ? 'source' and (c->>'source' is null or c->>'source' not in ('manual','imported','referral')) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if c->>'type'='script.publish' and ((c ? 'scriptId') <> (c ? 'expectedVersion') or (c ? 'expectedVersion' and coalesce((c->>'expectedVersion')::integer,0)<1)) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if c->>'type'='import.commit' then
  if jsonb_typeof(c->'rows') is distinct from 'array' or jsonb_array_length(c->'rows') not between 1 and 1000 then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
  if (select count(distinct entry->>'row') from jsonb_array_elements(c->'rows') entry)<>jsonb_array_length(c->'rows') then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
  for r in select * from jsonb_array_elements(c->'rows') loop
   if exists(select 1 from jsonb_object_keys(r) k where k not in ('row','name','email','phone','choice','targetId','expectedRevision','allowDuplicate')) or coalesce((r->>'row')::integer,0)<2 then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
   if r->>'choice'='merge' and (r->>'targetId' is null or r->>'expectedRevision' is null or (r->>'expectedRevision')::integer<0) then raise exception using message='VALIDATION',errcode='P0001'; end if;
  end loop;
 end if;
end; $$;
revoke all on function private.validate_r1_command(jsonb,uuid) from public,anon,authenticated;
create or replace function private.transition(p_owner uuid,p_id uuid,p_stage public.lifecycle_stage,p_next jsonb,p_reason text,p_operation uuid) returns void
language plpgsql security definer set search_path='' as $$
declare l public.lead_profiles; allowed boolean; begin
 perform private.assert_person(p_owner,p_id);
 select * into l from public.lead_profiles where owner_id=p_owner and person_id=p_id for update;
 allowed := case l.stage
 when 'new' then p_stage in ('follow_up','pending_signup','not_interested','closed')
 when 'follow_up' then p_stage in ('pending_signup','paused','not_interested','closed')
 when 'pending_signup' then p_stage in ('active','follow_up','paused','not_interested','closed')
 when 'active' then p_stage in ('paused','closed')
 when 'paused' then p_stage in ('follow_up','pending_signup','active','not_interested','closed')
 else p_stage in ('new','follow_up') end;
 if not allowed then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
 if p_stage='follow_up' and (p_next->>'type' is null or p_next->>'dueAt' is null) then raise exception using message='MISSING_NEXT_ACTION',errcode='P0001'; end if;
 if p_stage='pending_signup' and l.conversation_outcome is null then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
 if p_stage='active' and not exists(select 1 from public.onboarding_cases where owner_id=p_owner and person_id=p_id and decision='approved') then raise exception using message='ONBOARDING_INCOMPLETE',errcode='P0001'; end if;
 if p_stage in ('paused','not_interested','closed') and coalesce(length(trim(p_reason)),0)=0 then raise exception using message='VALIDATION',errcode='P0001'; end if;
 update public.lead_profiles set stage=p_stage,stage_entered_at=now(),reason=p_reason,
 next_action_type=case when p_stage in ('closed','not_interested') then null else (p_next->>'type')::public.action_type end,
 next_action_at=case when p_stage in ('closed','not_interested') then null else (p_next->>'dueAt')::timestamptz end,
 revision=revision+1,updated_at=now() where id=l.id;
 if p_stage in ('closed','not_interested') then update public.tasks set status='cancelled',revision=revision+1,updated_at=now() where owner_id=p_owner and person_id=p_id and status='open'; end if;
 insert into public.lifecycle_history(owner_id,person_id,from_stage,to_stage,operation_id,reason,next_action) values(p_owner,p_id,l.stage,p_stage,p_operation,p_reason,case when p_stage not in ('closed','not_interested') and p_next is not null then p_next||jsonb_build_object('ownerId',p_owner) else null end);
 insert into public.activities(owner_id,person_id,kind,summary) values(p_owner,p_id,'stage_change',l.stage::text||' → '||p_stage::text);
 perform private.touch_person(p_owner,p_id);
end; $$;

create or replace function public.crm_command(p_operation uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid; kind text; target uuid; result jsonb; previous private.operations; p public.people; source public.people;
 l public.lead_profiles; task public.tasks; onboarding public.onboarding_cases; batch public.import_batches;
 item jsonb; entries jsonb; v_blockers jsonb; manifest jsonb:='[]'; rowdata jsonb; script uuid; version integer;
 next_stage public.lifecycle_stage; next_date timestamptz; old_record jsonb; new_record jsonb; audit_detail jsonb := '{}'; result_revision integer; next_task uuid; reconciliation jsonb := '[]';
begin
 u:=private.require_ceo();
 if p_operation is null or jsonb_typeof(p_command)<>'object' then raise exception using message='VALIDATION',errcode='P0001'; end if;
 -- Serialize commands for the single CEO; idempotency and revisions are checked inside the lock.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into previous from private.operations where owner_id=u and id=p_operation;
 if found then
  if previous.payload<>p_command then raise exception using message='CONFLICT',errcode='P0001'; end if;
  return previous.result;
 end if;
 if not private.consume_limit('command:'||u,120,60) then raise exception using message='RATE_LIMITED',errcode='P0001'; end if;
 kind:=p_command->>'type'; target:=(p_command->>'id')::uuid;
 perform private.validate_r1_command(p_command,u);
 if kind in ('person.update','person.archive','organization.update','lifecycle.transition','next_action.schedule','onboarding.item','onboarding.decide','task.complete','task.snooze','task.cancel','person.merge','client.review','notification.preferences','file.finalize') and (p_command->>'expectedRevision' is null or (p_command->>'expectedRevision')::integer<0) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if kind='person.merge' and p_command->>'sourceRevision' is null then raise exception using message='VALIDATION',errcode='P0001'; end if;
 case kind
 when 'person.create' then
  insert into public.people(owner_id,name,emails,phones,notes,consent_note,organization_id,source,source_note,communication_restricted,consent_recorded_at,consent_recorded_by)
  values(u,trim(p_command->>'name'),array(select jsonb_array_elements_text(coalesce(p_command->'emails','[]'))),array(select jsonb_array_elements_text(coalesce(p_command->'phones','[]'))),coalesce(p_command->>'notes',''),coalesce(p_command->>'consentNote',''),(p_command->>'organizationId')::uuid,coalesce(p_command->>'source','manual'),coalesce(p_command->>'sourceNote',''),coalesce((p_command->>'communicationRestricted')::boolean,false),case when coalesce(p_command->>'consentNote','')<>'' or coalesce((p_command->>'communicationRestricted')::boolean,false) then now() end,case when coalesce(p_command->>'consentNote','')<>'' or coalesce((p_command->>'communicationRestricted')::boolean,false) then u end) returning id into target;
  audit_detail:=jsonb_build_object('source',coalesce(p_command->>'source','manual'),'sourceNote',coalesce(p_command->>'sourceNote',''),'consentNote',coalesce(p_command->>'consentNote',''),'communicationRestricted',coalesce((p_command->>'communicationRestricted')::boolean,false));
  insert into public.lead_profiles(owner_id,person_id) values(u,target);
 when 'person.update' then
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer);
  update public.people set name=trim(p_command->>'name'),emails=array(select jsonb_array_elements_text(p_command->'emails')),phones=array(select jsonb_array_elements_text(p_command->'phones')),notes=p_command->>'notes',consent_note=p_command->>'consentNote',source_note=coalesce(p_command->>'sourceNote',source_note),communication_restricted=coalesce((p_command->>'communicationRestricted')::boolean,communication_restricted),consent_recorded_at=case when consent_note is distinct from p_command->>'consentNote' or communication_restricted is distinct from coalesce((p_command->>'communicationRestricted')::boolean,communication_restricted) then now() else consent_recorded_at end,consent_recorded_by=case when consent_note is distinct from p_command->>'consentNote' or communication_restricted is distinct from coalesce((p_command->>'communicationRestricted')::boolean,communication_restricted) then u else consent_recorded_by end,revision=revision+1,updated_at=now() where id=target;
  audit_detail:=jsonb_build_object('before',jsonb_build_object('sourceNote',p.source_note,'consentNote',p.consent_note,'communicationRestricted',p.communication_restricted),'after',jsonb_build_object('sourceNote',coalesce(p_command->>'sourceNote',p.source_note),'consentNote',p_command->>'consentNote','communicationRestricted',coalesce((p_command->>'communicationRestricted')::boolean,p.communication_restricted)));
 when 'person.archive' then
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer);
  if not exists(select 1 from public.lead_profiles where owner_id=u and person_id=target and stage in ('closed','not_interested')) then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  update public.people set archived_at=now(),updated_at=now(),revision=revision+1 where id=target;
 when 'organization.create' then
  insert into public.organizations(owner_id,name,notes) values(u,trim(p_command->>'name'),coalesce(p_command->>'notes','')) returning id into target;
 when 'organization.update' then
  update public.organizations set name=trim(p_command->>'name'),notes=p_command->>'notes',revision=revision+1,updated_at=now() where owner_id=u and id=target and revision=(p_command->>'expectedRevision')::integer;
  if not found then raise exception using message='CONFLICT',errcode='P0001'; end if;
 when 'lifecycle.transition' then
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer);
  perform private.transition(u,target,(p_command->>'stage')::public.lifecycle_stage,p_command->'nextAction',p_command->>'reason',p_operation);
 when 'next_action.schedule' then
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer);
  if p_command->'nextAction'->>'type' is null or p_command->'nextAction'->>'dueAt' is null then raise exception using message='MISSING_NEXT_ACTION',errcode='P0001'; end if;
  update public.lead_profiles set next_action_type=(p_command->'nextAction'->>'type')::public.action_type,next_action_at=(p_command->'nextAction'->>'dueAt')::timestamptz,revision=revision+1,updated_at=now() where owner_id=u and person_id=target and stage not in ('closed','not_interested');
  if not found then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  perform private.touch_person(u,target);
 when 'activity.create' then
  target:=(p_command->>'personId')::uuid; p:=private.assert_person(u,target);
  select * into l from public.lead_profiles where owner_id=u and person_id=target;
  if l.stage in ('closed','not_interested') then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  if p_command->>'kind'='call' then
   if p_command->>'outcome' is null or p_command->>'outcome' not in ('no_answer','follow_up','interested','not_interested','completed') then raise exception using message='VALIDATION',errcode='P0001'; end if;
   if p_command->>'outcome'<>'not_interested' and (p_command->'nextAction'->>'type' is null or p_command->'nextAction'->>'dueAt' is null) then raise exception using message='MISSING_NEXT_ACTION',errcode='P0001'; end if;
   update public.lead_profiles set conversation_outcome=p_command->>'outcome',last_contact_at=case when p_command->>'outcome'='no_answer' then last_contact_at else now() end where id=l.id;
   if l.stage<>'active' then
    next_stage:=case p_command->>'outcome' when 'interested' then 'pending_signup' when 'not_interested' then 'not_interested' else 'follow_up' end;
    if next_stage<>l.stage then perform private.transition(u,target,next_stage,p_command->'nextAction','Call outcome recorded',p_operation); end if;
   end if;
  end if;
  if p_command->>'kind' in ('message','email','meeting') then update public.lead_profiles set last_contact_at=now() where id=l.id; end if;
  if p_command->'nextAction' is not null then update public.lead_profiles set next_action_type=(p_command->'nextAction'->>'type')::public.action_type,next_action_at=(p_command->'nextAction'->>'dueAt')::timestamptz where id=l.id and stage not in ('closed','not_interested'); end if;
  insert into public.activities(owner_id,person_id,kind,summary,outcome,script_version_id) values(u,target,p_command->>'kind',coalesce(p_command->>'summary',''),p_command->>'outcome',(p_command->>'scriptVersionId')::uuid);
  perform private.touch_person(u,target);
 when 'onboarding.start' then
  target:=(p_command->>'personId')::uuid; p:=private.assert_person(u,target);
  if not exists(select 1 from public.lead_profiles where owner_id=u and person_id=target and stage='pending_signup') or exists(select 1 from public.onboarding_cases where owner_id=u and person_id=target and decision in ('pending','approved')) then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',x->>'title','required',coalesce((x->>'required')::boolean,true),'completed',false,'waiverReason',null)),'[]') into entries from jsonb_array_elements(p_command->'items') x;
  if jsonb_array_length(entries)=0 then raise exception using message='VALIDATION',errcode='P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',x,'required',true,'completed',false,'waiverReason',null)),'[]') into v_blockers from jsonb_array_elements_text(coalesce(p_command->'blockers','[]')) x;
  insert into public.onboarding_cases(owner_id,person_id,template_id,template_version,items,blockers,due_at) values(u,target,(p_command->>'templateId')::uuid,(p_command->>'templateVersion')::integer,entries,v_blockers,(p_command->>'dueAt')::timestamptz) returning id into target;
 when 'onboarding.item' then
  select * into onboarding from public.onboarding_cases where owner_id=u and id=target and decision='pending' for update;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  perform private.assert_person(u,onboarding.person_id);
  if not exists(select 1 from public.lead_profiles where owner_id=u and person_id=onboarding.person_id and stage='pending_signup') then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  if onboarding.revision<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if p_command ? 'waiverReason' and coalesce(length(trim(p_command->>'waiverReason')),0)=0 then raise exception using message='VALIDATION',errcode='P0001'; end if;
  if not exists(select 1 from jsonb_array_elements(onboarding.items||onboarding.blockers) x where x->>'id'=p_command->>'itemId') then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  select jsonb_agg(case when x->>'id'=p_command->>'itemId' then x||jsonb_build_object('completed',not(p_command ? 'waiverReason'),'waiverReason',p_command->>'waiverReason') else x end) into entries from jsonb_array_elements(onboarding.items) x;
  select coalesce(jsonb_agg(case when x->>'id'=p_command->>'itemId' then x||jsonb_build_object('completed',not(p_command ? 'waiverReason'),'waiverReason',p_command->>'waiverReason') else x end),'[]') into v_blockers from jsonb_array_elements(onboarding.blockers) x;
  update public.onboarding_cases set items=entries,blockers=v_blockers,revision=revision+1,updated_at=now() where id=target;
  audit_detail:=jsonb_build_object('itemId',p_command->>'itemId','waiverReason',p_command->>'waiverReason');
  insert into public.activities(owner_id,person_id,kind,summary) values(u,onboarding.person_id,'onboarding',case when p_command ? 'waiverReason' then 'Checklist item explicitly waived' else 'Checklist item completed' end);
 when 'onboarding.decide' then
  select * into onboarding from public.onboarding_cases where owner_id=u and id=target and decision='pending' for update;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  perform private.assert_person(u,onboarding.person_id);
  if not exists(select 1 from public.lead_profiles where owner_id=u and person_id=onboarding.person_id and stage='pending_signup') then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  if onboarding.revision<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if coalesce(length(trim(p_command->>'rationale')),0)=0 or p_command->>'approve' is null then raise exception using message='VALIDATION',errcode='P0001'; end if;
  if (p_command->>'approve')::boolean and exists(select 1 from jsonb_array_elements(onboarding.items||onboarding.blockers) x where coalesce((x->>'required')::boolean,true) and not coalesce((x->>'completed')::boolean,false) and coalesce(length(trim(x->>'waiverReason')),0)=0) then raise exception using message='ONBOARDING_INCOMPLETE',errcode='P0001'; end if;
  update public.onboarding_cases set decision=case when (p_command->>'approve')::boolean then 'approved' else 'rejected' end,rationale=p_command->>'rationale',decided_at=now(),revision=revision+1,updated_at=now() where id=target;
  audit_detail:=jsonb_build_object('approve',(p_command->>'approve')::boolean,'rationale',p_command->>'rationale');
  if (p_command->>'approve')::boolean then
   perform private.transition(u,onboarding.person_id,'active',jsonb_build_object('type','review','dueAt',now()+interval '30 days'),null,p_operation);
   insert into public.client_accounts(owner_id,person_id,approved_at,review_at) values(u,onboarding.person_id,now(),now()+interval '30 days') on conflict(owner_id,person_id) do nothing;
  end if;
  insert into public.activities(owner_id,person_id,kind,summary) values(u,onboarding.person_id,'decision',case when (p_command->>'approve')::boolean then 'Onboarding approved' else 'Onboarding rejected' end);
 when 'task.create' then
  p:=private.assert_person(u,(p_command->>'personId')::uuid);
  if exists(select 1 from public.lead_profiles where person_id=p.id and stage in ('closed','not_interested')) then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  insert into public.tasks(owner_id,person_id,title,due_at,priority,recurrence) values(u,p.id,p_command->>'title',(p_command->>'dueAt')::timestamptz,coalesce(p_command->>'priority','normal'),p_command->'recurrence') returning id into target;
 when 'task.complete','task.snooze','task.cancel' then
  select * into task from public.tasks where owner_id=u and id=target and status='open' for update;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  if task.revision<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  perform private.assert_person(u,task.person_id);
  if kind='task.snooze' then
   if (p_command->>'dueAt')::timestamptz<=now() then raise exception using message='VALIDATION',errcode='P0001'; end if;
   update public.tasks set due_at=(p_command->>'dueAt')::timestamptz,revision=revision+1,updated_at=now() where id=target;
  elsif kind='task.cancel' then
   if coalesce(length(trim(p_command->>'reason')),0)=0 then raise exception using message='VALIDATION',errcode='P0001'; end if;
   update public.tasks set status='cancelled',evidence=p_command->>'reason',revision=revision+1,updated_at=now() where id=target;
  else
   update public.tasks set status='completed',completed_at=now(),evidence=p_command->>'evidence',revision=revision+1,updated_at=now() where id=target;
   insert into public.activities(owner_id,person_id,kind,summary) values(u,task.person_id,'task_completion','Commitment completed');
   if task.recurrence is not null then
    next_date:=task.due_at+case task.recurrence->>'unit' when 'day' then make_interval(days=>(task.recurrence->>'interval')::integer) when 'week' then make_interval(weeks=>(task.recurrence->>'interval')::integer) else make_interval(months=>(task.recurrence->>'interval')::integer) end;
    insert into public.tasks(owner_id,person_id,title,due_at,priority,recurrence) values(u,task.person_id,task.title,next_date,task.priority,task.recurrence) returning id into next_task;
   end if;
  end if;
 when 'script.publish' then
  script:=(p_command->>'scriptId')::uuid;
  if script is null then insert into public.scripts(owner_id,name,stage) values(u,p_command->>'name',(p_command->>'stage')::public.lifecycle_stage) returning id into script;
  elsif not exists(select 1 from public.scripts where owner_id=u and id=script) then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  select coalesce(max(v.version),0)+1 into version from public.script_versions v where owner_id=u and script_id=script;
  if p_command ? 'scriptId' and (p_command->>'expectedVersion')::integer<>version-1 then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if exists(select 1 from public.scripts where id=script and (name<>p_command->>'name' or stage<>(p_command->>'stage')::public.lifecycle_stage)) then raise exception using message='VALIDATION',errcode='P0001'; end if;
  insert into public.script_versions(owner_id,script_id,version,content,disclosures,change_note) values(u,script,version,p_command->>'content',p_command->>'disclosures',p_command->>'changeNote') returning id into target;
 when 'referral.create' then
  p:=private.assert_person(u,(p_command->>'personId')::uuid); perform private.assert_person(u,(p_command->>'referrerId')::uuid);
  if exists(select 1 from public.lead_profiles where person_id=p.id and stage in ('closed','not_interested')) then raise exception using message='INVALID_TRANSITION',errcode='P0001'; end if;
  if exists(select 1 from public.referrals where owner_id=u and person_id=p.id and referrer_id=(p_command->>'referrerId')::uuid) then raise exception using message='DUPLICATE',errcode='P0001'; end if;
  insert into public.referrals(owner_id,referrer_id,person_id,source_note) values(u,(p_command->>'referrerId')::uuid,p.id,p_command->>'sourceNote') returning id into target;
  update public.lead_profiles set next_action_type='call',next_action_at=now() where owner_id=u and person_id=p.id and stage='new' and next_action_at is null;
  insert into public.activities(owner_id,person_id,kind,summary) values(u,p.id,'referral','Referral recorded');
  perform private.touch_person(u,p.id);
 when 'relationship.create' then
  perform private.assert_person(u,(p_command->>'fromId')::uuid); perform private.assert_person(u,(p_command->>'toId')::uuid);
  insert into public.relationship_edges(owner_id,from_id,to_id,kind,explanation) values(u,(p_command->>'fromId')::uuid,(p_command->>'toId')::uuid,p_command->>'kind',p_command->>'explanation') returning id into target;
 when 'client.review' then
  target:=(p_command->>'personId')::uuid; p:=private.assert_person(u,target);
  update public.client_accounts set review_at=(p_command->>'reviewAt')::timestamptz,risks=array(select jsonb_array_elements_text(p_command->'risks')),revision=revision+1,updated_at=now() where owner_id=u and person_id=target and revision=(p_command->>'expectedRevision')::integer;
  if not found then raise exception using message='CONFLICT',errcode='P0001'; end if;
 when 'person.merge' then
  target:=(p_command->>'targetId')::uuid;
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer); source:=private.assert_person(u,(p_command->>'sourceId')::uuid,(p_command->>'sourceRevision')::integer);
  if p.id=source.id then raise exception using message='DUPLICATE',errcode='P0001'; end if;
  if exists(select 1 from public.onboarding_cases where owner_id=u and person_id=source.id) or exists(select 1 from public.client_accounts where owner_id=u and person_id=source.id) then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if (select stage from public.lead_profiles where person_id=source.id)<>(select stage from public.lead_profiles where person_id=target) or exists(select 1 from public.lead_profiles where person_id=source.id and next_action_at is not null) then raise exception using message='CONFLICT',errcode='P0001'; end if;
  update public.people set emails=array(select distinct unnest(p.emails||source.emails)),phones=array(select distinct unnest(p.phones||source.phones)),tags=array(select distinct unnest(p.tags||source.tags)),notes=concat_ws(E'\n',nullif(p.notes,''),nullif(source.notes,'')),revision=revision+1,updated_at=now() where id=target;
  update public.people set merged_into=target,archived_at=now(),revision=revision+1,updated_at=now() where id=source.id;
  update public.tasks set person_id=target,revision=revision+1,updated_at=now() where owner_id=u and person_id=source.id;
  update public.file_agreements set person_id=target,revision=revision+1,updated_at=now() where owner_id=u and person_id=source.id;
  -- Immutable timeline, referral and relationship attribution retains source IDs through recoverable redirects.
 when 'import.commit' then
  if jsonb_typeof(p_command->'rows')<>'array' or jsonb_array_length(p_command->'rows')>1000 then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
  target:=gen_random_uuid();
  for rowdata in select * from jsonb_array_elements(p_command->'rows') loop
   if rowdata->>'choice'='skip' then reconciliation:=reconciliation||jsonb_build_array(jsonb_build_object('row',(rowdata->>'row')::integer,'action','skipped','personId',null)); continue; end if;
   if coalesce(length(trim(rowdata->>'name')),0)=0 or (coalesce(rowdata->>'email','')<>'' and rowdata->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
   if length(trim(rowdata->>'name'))>200 or length(coalesce(rowdata->>'email',''))>320 or (coalesce(rowdata->>'phone','')<>'' and (rowdata->>'phone' !~ '^[+0-9 ().-]+$' or length(regexp_replace(rowdata->>'phone','[^0-9]','','g'))<7 or length(rowdata->>'phone')>40)) then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
   if rowdata->>'choice'='create' then
    if not coalesce((rowdata->>'allowDuplicate')::boolean,false) and exists(select 1 from public.people e where e.owner_id=u and e.archived_at is null and e.merged_into is null and (lower(trim(e.name))=lower(trim(rowdata->>'name')) or (coalesce(rowdata->>'email','')<>'' and exists(select 1 from unnest(e.emails) em where lower(trim(em))=lower(trim(rowdata->>'email')))) or (coalesce(rowdata->>'phone','')<>'' and exists(select 1 from unnest(e.phones) ph where regexp_replace(ph,'[^0-9]','','g')=regexp_replace(rowdata->>'phone','[^0-9]','','g'))))) then raise exception using message='DUPLICATE',errcode='P0001'; end if;
    insert into public.people(owner_id,name,emails,phones,source) values(u,trim(rowdata->>'name'),case when coalesce(rowdata->>'email','')='' then '{}' else array[lower(trim(rowdata->>'email'))] end,case when coalesce(rowdata->>'phone','')='' then '{}' else array[rowdata->>'phone'] end,'imported') returning * into p;
    insert into public.lead_profiles(owner_id,person_id) values(u,p.id);
    manifest:=manifest||jsonb_build_array(jsonb_build_object('id',p.id,'created',true,'after',to_jsonb(p)));
   elsif rowdata->>'choice'='merge' then
    p:=private.assert_person(u,(rowdata->>'targetId')::uuid,(rowdata->>'expectedRevision')::integer); old_record:=to_jsonb(p);
    update public.people set emails=array(select distinct x from unnest(p.emails||array[lower(trim(rowdata->>'email'))]) x where x<>''),phones=array(select distinct x from unnest(p.phones||array[rowdata->>'phone']) x where x<>''),revision=revision+1,updated_at=now() where id=p.id returning to_jsonb(people.*) into new_record;
    manifest:=manifest||jsonb_build_array(jsonb_build_object('id',p.id,'created',false,'before',old_record,'after',new_record));
   else raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
   reconciliation:=reconciliation||jsonb_build_array(jsonb_build_object('row',(rowdata->>'row')::integer,'action',case when rowdata->>'choice'='create' then 'created' else 'merged' end,'personId',p.id));
  end loop;
  insert into public.import_batches(id,owner_id,manifest,row_count,results) values(target,u,manifest,jsonb_array_length(manifest),reconciliation);
 when 'import.rollback' then
  select * into batch from public.import_batches where owner_id=u and id=target and status='committed' for update;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  -- Reverse row order also correctly restores repeated merges into the same record in a batch.
  for item in select value from jsonb_array_elements(batch.manifest) with ordinality order by ordinality desc loop
   select * into p from public.people where owner_id=u and id=(item->>'id')::uuid for update;
   if not found or to_jsonb(p)<>item->'after' then raise exception using message='ROLLBACK_CONFLICT',errcode='P0001'; end if;
   if (item->>'created')::boolean then
    if exists(select 1 from public.audit_events where owner_id=u and target_id=p.id and created_at>batch.created_at) then raise exception using message='ROLLBACK_CONFLICT',errcode='P0001'; end if;
    begin delete from public.people where id=p.id; exception when foreign_key_violation then raise exception using message='ROLLBACK_CONFLICT',errcode='P0001'; end;
   else
    update public.people set emails=array(select jsonb_array_elements_text(item->'before'->'emails')),phones=array(select jsonb_array_elements_text(item->'before'->'phones')),revision=(item->'before'->>'revision')::integer,updated_at=(item->'before'->>'updated_at')::timestamptz where id=p.id;
   end if;
  end loop;
  update public.people p2 set revision=p2.revision+1+(select max((m->'after'->>'revision')::integer)-min((m->'before'->>'revision')::integer) from jsonb_array_elements(batch.manifest) m where (m->>'id')::uuid=p2.id and not (m->>'created')::boolean),updated_at=now()
  where p2.owner_id=u and p2.id in (select (m->>'id')::uuid from jsonb_array_elements(batch.manifest) m where not (m->>'created')::boolean);
  update public.import_batches set status='rolled_back',rolled_back_at=now(),revision=revision+1 where id=target;
 when 'notification.preferences' then
  audit_detail:=jsonb_build_object('before',coalesce((select jsonb_build_object('emailEnabled',email_enabled,'webPushEnabled',web_push_enabled) from public.notification_preferences where owner_id=u),jsonb_build_object('emailEnabled',false,'webPushEnabled',false)),'after',jsonb_build_object('emailEnabled',(p_command->>'emailEnabled')::boolean,'webPushEnabled',(p_command->>'webPushEnabled')::boolean));
  if coalesce((select revision from public.notification_preferences where owner_id=u),0)<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  insert into public.notification_preferences(owner_id,revision,email_enabled,web_push_enabled) values(u,1,(p_command->>'emailEnabled')::boolean,(p_command->>'webPushEnabled')::boolean) on conflict(owner_id) do update set email_enabled=excluded.email_enabled,web_push_enabled=excluded.web_push_enabled,revision=notification_preferences.revision+1,updated_at=now() returning id into target;
 when 'file.register' then
  p:=private.assert_person(u,(p_command->>'personId')::uuid); target:=gen_random_uuid();
  if p_command->>'mimeType' not in ('application/pdf','image/png','image/jpeg','text/plain') then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
  insert into public.file_agreements(id,owner_id,person_id,display_name,storage_path,mime_type,size,expires_at) values(target,u,p.id,p_command->>'displayName',u::text||'/'||target::text,p_command->>'mimeType',(p_command->>'size')::bigint,(p_command->>'expiresAt')::timestamptz);
 when 'file.finalize' then
  if exists(select 1 from public.file_agreements where owner_id=u and id=target and revision<>(p_command->>'expectedRevision')::integer) then raise exception using message='CONFLICT',errcode='P0001'; end if;
  -- Storage object metadata is verified inside PostgreSQL too, so a direct RPC cannot fake completion.
  update public.file_agreements f set status='available',revision=revision+1,updated_at=now()
  where f.owner_id=u and f.id=target and f.status='pending' and exists(select 1 from storage.objects o where o.bucket_id='agreements' and o.name=f.storage_path and (o.metadata->>'size')::bigint=f.size and o.metadata->>'mimetype'=f.mime_type);
  if not found then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
 when 'security.event' then
  if p_command->>'event' not in ('sign_in','sign_out','file_access','file_upload','export') then raise exception using message='VALIDATION',errcode='P0001'; end if;
  target:=(p_command->>'targetId')::uuid;
  if p_command->>'event'='file_access' and not exists(select 1 from public.file_agreements where owner_id=u and id=target and status='available') then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
  if p_command->>'event'='file_upload' and not exists(select 1 from public.file_agreements where owner_id=u and id=target and status='pending') then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
  kind:='security.'||(p_command->>'event');
 else raise exception using message='VALIDATION',errcode='P0001';
 end case;
 select revision into result_revision from (
 select id,revision from public.people union all select id,revision from public.organizations union all select id,revision from public.onboarding_cases union all select id,revision from public.tasks union all select id,revision from public.file_agreements union all select id,revision from public.notification_preferences union all select id,revision from public.import_batches
 ) versions where id=target;
 if kind='client.review' then select revision into result_revision from public.client_accounts where owner_id=u and person_id=target; end if;
 result:=jsonb_strip_nulls(jsonb_build_object('id',coalesce(target,p_operation),'revision',result_revision,'nextTaskId',next_task));
 if kind='import.commit' then result:=result||jsonb_build_object('importRows',reconciliation); end if;
 if kind='script.publish' then result:=result||jsonb_build_object('scriptId',script,'version',version); end if;
 if kind in ('onboarding.start','onboarding.item','onboarding.decide') then
  select person_id into script from public.onboarding_cases where id=target;
  result:=result||jsonb_build_object('personId',script,'personRevision',(select revision from public.people where id=script));
 end if;
 insert into public.audit_events(owner_id,target_id,action,operation_id,metadata) values(u,target,kind,p_operation,jsonb_build_object('actorId',u,'boundary','authenticated_rpc')||audit_detail);
 insert into private.operations(owner_id,id,payload,result) values(u,p_operation,p_command,result);
 return result;
end; $$;

commit;
