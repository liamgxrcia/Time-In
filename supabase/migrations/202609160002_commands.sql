begin;
create function private.assert_person(p_owner uuid, p_id uuid, p_revision integer default null) returns public.people
language plpgsql security definer set search_path='' as $$
declare p public.people; begin
 select * into p from public.people where owner_id=p_owner and id=p_id and archived_at is null and merged_into is null for update;
 if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
 if p_revision is not null and p.revision<>p_revision then raise exception using message='CONFLICT',errcode='P0001'; end if;
 return p;
end; $$;
create function private.touch_person(p_owner uuid,p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.people set revision=revision+1,updated_at=now() where owner_id=p_owner and id=p_id;
$$;
create function private.transition(p_owner uuid,p_id uuid,p_stage public.lifecycle_stage,p_next jsonb,p_reason text,p_operation uuid) returns void
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
 insert into public.lifecycle_history(owner_id,person_id,from_stage,to_stage,operation_id) values(p_owner,p_id,l.stage,p_stage,p_operation);
 insert into public.activities(owner_id,person_id,kind,summary) values(p_owner,p_id,'stage_change',l.stage::text||' → '||p_stage::text);
 perform private.touch_person(p_owner,p_id);
end; $$;
create function public.ceo_authorized() returns boolean language sql stable security definer set search_path='' as $$ select private.is_ceo(); $$;
revoke all on function public.ceo_authorized() from public,anon;
grant execute on function public.ceo_authorized() to authenticated;

create function public.crm_command(p_operation uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid; kind text; target uuid; result jsonb; previous private.operations; p public.people; source public.people;
 l public.lead_profiles; task public.tasks; onboarding public.onboarding_cases; batch public.import_batches;
 item jsonb; entries jsonb; v_blockers jsonb; manifest jsonb:='[]'; rowdata jsonb; script uuid; version integer;
 next_stage public.lifecycle_stage; next_date timestamptz; old_record jsonb; new_record jsonb;
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
 if kind in ('person.update','person.archive','organization.update','lifecycle.transition','next_action.schedule','onboarding.item','onboarding.decide','task.complete','task.snooze','task.cancel','person.merge') and (p_command->>'expectedRevision' is null or (p_command->>'expectedRevision')::integer<0) then raise exception using message='VALIDATION',errcode='P0001'; end if;
 if kind='person.merge' and p_command->>'sourceRevision' is null then raise exception using message='VALIDATION',errcode='P0001'; end if;
 case kind
 when 'person.create' then
  insert into public.people(owner_id,name,emails,phones,notes,consent_note,organization_id)
  values(u,trim(p_command->>'name'),array(select jsonb_array_elements_text(coalesce(p_command->'emails','[]'))),array(select jsonb_array_elements_text(coalesce(p_command->'phones','[]'))),coalesce(p_command->>'notes',''),coalesce(p_command->>'consentNote',''),(p_command->>'organizationId')::uuid) returning id into target;
  insert into public.lead_profiles(owner_id,person_id) values(u,target);
 when 'person.update' then
  p:=private.assert_person(u,target,(p_command->>'expectedRevision')::integer);
  update public.people set name=trim(p_command->>'name'),emails=array(select jsonb_array_elements_text(p_command->'emails')),phones=array(select jsonb_array_elements_text(p_command->'phones')),notes=p_command->>'notes',consent_note=p_command->>'consentNote',revision=revision+1,updated_at=now() where id=target;
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
  if onboarding.revision<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if p_command ? 'waiverReason' and coalesce(length(trim(p_command->>'waiverReason')),0)=0 then raise exception using message='VALIDATION',errcode='P0001'; end if;
  if not exists(select 1 from jsonb_array_elements(onboarding.items||onboarding.blockers) x where x->>'id'=p_command->>'itemId') then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  select jsonb_agg(case when x->>'id'=p_command->>'itemId' then x||jsonb_build_object('completed',not(p_command ? 'waiverReason'),'waiverReason',p_command->>'waiverReason') else x end) into entries from jsonb_array_elements(onboarding.items) x;
  select coalesce(jsonb_agg(case when x->>'id'=p_command->>'itemId' then x||jsonb_build_object('completed',not(p_command ? 'waiverReason'),'waiverReason',p_command->>'waiverReason') else x end),'[]') into v_blockers from jsonb_array_elements(onboarding.blockers) x;
  update public.onboarding_cases set items=entries,blockers=v_blockers,revision=revision+1,updated_at=now() where id=target;
  insert into public.activities(owner_id,person_id,kind,summary) values(u,onboarding.person_id,'onboarding',case when p_command ? 'waiverReason' then 'Checklist item explicitly waived' else 'Checklist item completed' end);
 when 'onboarding.decide' then
  select * into onboarding from public.onboarding_cases where owner_id=u and id=target and decision='pending' for update;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  if onboarding.revision<>(p_command->>'expectedRevision')::integer then raise exception using message='CONFLICT',errcode='P0001'; end if;
  if coalesce(length(trim(p_command->>'rationale')),0)=0 or p_command->>'approve' is null then raise exception using message='VALIDATION',errcode='P0001'; end if;
  if (p_command->>'approve')::boolean and exists(select 1 from jsonb_array_elements(onboarding.items||onboarding.blockers) x where coalesce((x->>'required')::boolean,true) and not coalesce((x->>'completed')::boolean,false) and coalesce(length(trim(x->>'waiverReason')),0)=0) then raise exception using message='ONBOARDING_INCOMPLETE',errcode='P0001'; end if;
  update public.onboarding_cases set decision=case when (p_command->>'approve')::boolean then 'approved' else 'rejected' end,rationale=p_command->>'rationale',decided_at=now(),revision=revision+1,updated_at=now() where id=target;
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
    insert into public.tasks(owner_id,person_id,title,due_at,priority,recurrence) values(u,task.person_id,task.title,next_date,task.priority,task.recurrence);
   end if;
  end if;
 when 'script.publish' then
  script:=(p_command->>'scriptId')::uuid;
  if script is null then insert into public.scripts(owner_id,name,stage) values(u,p_command->>'name',(p_command->>'stage')::public.lifecycle_stage) returning id into script;
  elsif not exists(select 1 from public.scripts where owner_id=u and id=script) then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  select coalesce(max(v.version),0)+1 into version from public.script_versions v where owner_id=u and script_id=script;
  insert into public.script_versions(owner_id,script_id,version,content,disclosures,change_note) values(u,script,version,p_command->>'content',p_command->>'disclosures',p_command->>'changeNote') returning id into target;
 when 'referral.create' then
  p:=private.assert_person(u,(p_command->>'personId')::uuid); perform private.assert_person(u,(p_command->>'referrerId')::uuid);
  insert into public.referrals(owner_id,referrer_id,person_id,source_note) values(u,(p_command->>'referrerId')::uuid,p.id,p_command->>'sourceNote') returning id into target;
  update public.lead_profiles set next_action_type='call',next_action_at=now() where owner_id=u and person_id=p.id and stage='new' and next_action_at is null;
  insert into public.activities(owner_id,person_id,kind,summary) values(u,p.id,'referral','Referral recorded');
  perform private.touch_person(u,p.id);
 when 'relationship.create' then
  perform private.assert_person(u,(p_command->>'fromId')::uuid); perform private.assert_person(u,(p_command->>'toId')::uuid);
  insert into public.relationship_edges(owner_id,from_id,to_id,kind,explanation) values(u,(p_command->>'fromId')::uuid,(p_command->>'toId')::uuid,p_command->>'kind',p_command->>'explanation') returning id into target;
 when 'client.review' then
  target:=(p_command->>'personId')::uuid; p:=private.assert_person(u,target);
  update public.client_accounts set review_at=(p_command->>'reviewAt')::timestamptz,risks=array(select jsonb_array_elements_text(p_command->'risks')),revision=revision+1,updated_at=now() where owner_id=u and person_id=target;
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
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
   if rowdata->>'choice'='skip' then continue; end if;
   if coalesce(length(trim(rowdata->>'name')),0)=0 or (coalesce(rowdata->>'email','')<>'' and rowdata->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
   if rowdata->>'choice'='create' then
    insert into public.people(owner_id,name,emails,phones,source) values(u,trim(rowdata->>'name'),case when coalesce(rowdata->>'email','')='' then '{}' else array[lower(trim(rowdata->>'email'))] end,case when coalesce(rowdata->>'phone','')='' then '{}' else array[rowdata->>'phone'] end,'imported') returning * into p;
    insert into public.lead_profiles(owner_id,person_id) values(u,p.id);
    manifest:=manifest||jsonb_build_array(jsonb_build_object('id',p.id,'created',true,'after',to_jsonb(p)));
   elsif rowdata->>'choice'='merge' then
    p:=private.assert_person(u,(rowdata->>'targetId')::uuid); old_record:=to_jsonb(p);
    update public.people set emails=array(select distinct x from unnest(p.emails||array[lower(trim(rowdata->>'email'))]) x where x<>''),phones=array(select distinct x from unnest(p.phones||array[rowdata->>'phone']) x where x<>''),revision=revision+1,updated_at=now() where id=p.id returning to_jsonb(people.*) into new_record;
    manifest:=manifest||jsonb_build_array(jsonb_build_object('id',p.id,'created',false,'before',old_record,'after',new_record));
   else raise exception using message='IMPORT_INVALID',errcode='P0001'; end if;
  end loop;
  insert into public.import_batches(id,owner_id,manifest,row_count) values(target,u,manifest,jsonb_array_length(manifest));
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
  update public.import_batches set status='rolled_back',rolled_back_at=now(),revision=revision+1 where id=target;
 when 'notification.preferences' then
  insert into public.notification_preferences(owner_id,email_enabled,web_push_enabled) values(u,(p_command->>'emailEnabled')::boolean,(p_command->>'webPushEnabled')::boolean) on conflict(owner_id) do update set email_enabled=excluded.email_enabled,web_push_enabled=excluded.web_push_enabled,revision=notification_preferences.revision+1,updated_at=now() returning id into target;
 when 'file.register' then
  p:=private.assert_person(u,(p_command->>'personId')::uuid); target:=gen_random_uuid();
  if p_command->>'mimeType' not in ('application/pdf','image/png','image/jpeg','text/plain') then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
  insert into public.file_agreements(id,owner_id,person_id,display_name,storage_path,mime_type,size,expires_at) values(target,u,p.id,p_command->>'displayName',u::text||'/'||target::text,p_command->>'mimeType',(p_command->>'size')::bigint,(p_command->>'expiresAt')::timestamptz);
 when 'file.finalize' then
  -- Storage object metadata is verified inside PostgreSQL too, so a direct RPC cannot fake completion.
  update public.file_agreements f set status='available',revision=revision+1,updated_at=now()
  where f.owner_id=u and f.id=target and f.status='pending' and exists(select 1 from storage.objects o where o.bucket_id='agreements' and o.name=f.storage_path and (o.metadata->>'size')::bigint=f.size and o.metadata->>'mimetype'=f.mime_type);
  if not found then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
 when 'security.event' then
  if p_command->>'event' not in ('sign_in','sign_out','file_access','export') then raise exception using message='VALIDATION',errcode='P0001'; end if;
  target:=(p_command->>'targetId')::uuid;
  if p_command->>'event'='file_access' and not exists(select 1 from public.file_agreements where owner_id=u and id=target and status='available') then raise exception using message='FILE_ACCESS',errcode='P0001'; end if;
  kind:='security.'||(p_command->>'event');
 else raise exception using message='VALIDATION',errcode='P0001';
 end case;
 result:=jsonb_build_object('id',coalesce(target,p_operation));
 insert into public.audit_events(owner_id,target_id,action,operation_id,metadata) values(u,target,kind,p_operation,jsonb_build_object('source','authenticated_rpc'));
 insert into private.operations(owner_id,id,payload,result) values(u,p_operation,p_command,result);
 return result;
end; $$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_ceo() to authenticated;
revoke all on function public.crm_command(uuid,jsonb) from public,anon;
grant execute on function public.crm_command(uuid,jsonb) to authenticated;
-- Distributed pre-auth rate limiter; key must be a server-generated HMAC, never raw email/IP.
create function public.consume_auth_limit(p_key text) returns boolean language sql security definer set search_path='' as $$ select private.consume_limit('auth:'||p_key,10,900); $$;
revoke all on function public.consume_auth_limit(text) from public,anon,authenticated;
grant execute on function public.consume_auth_limit(text) to service_role;
commit;
