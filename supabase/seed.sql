-- Explicit development seed. First provision the CEO and set app.seed_ceo in this SQL session.
-- Example: SET app.seed_ceo = 'your-development-ceo-uuid'; then run this file.
-- Never attach seed.sql to a production migration/deployment command.
begin;
do $$
declare u uuid; result jsonb; person_id uuid; onboarding_id uuid; record_item jsonb; i integer;
 names text[]:=array['Alex Rowan','Jordan Ellis','Taylor Morgan','Casey Blake','Riley Hart','Drew Parker','Sam Avery','Morgan Reed','Quinn Hayes','Jamie Brook'];
 ids uuid[]:='{}';
begin
 u:=nullif(current_setting('app.seed_ceo',true),'')::uuid;
 if u is null or not exists(select 1 from private.ceo_access where user_id=u and enabled) then raise exception 'Provision a development CEO and SET app.seed_ceo before seeding'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 for i in 1..10 loop
  result:=public.crm_command(('90000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,jsonb_build_object('type','person.create','name',names[i],'emails',jsonb_build_array('person'||i||'@example.com'),'consentNote','Fictional development record'));
  ids:=array_append(ids,(result->>'id')::uuid);
 end loop;
 -- Stable operation payloads and IDs make repeated seed runs safe.
 perform public.crm_command('90000000-0000-4000-8000-000000000101',jsonb_build_object('type','lifecycle.transition','id',ids[2],'expectedRevision',0,'stage','follow_up','nextAction',jsonb_build_object('type','call','dueAt','2026-09-14T14:00:00Z')));
 perform public.crm_command('90000000-0000-4000-8000-000000000102',jsonb_build_object('type','lifecycle.transition','id',ids[3],'expectedRevision',0,'stage','follow_up','nextAction',jsonb_build_object('type','call','dueAt','2026-09-16T16:00:00Z')));
 perform public.crm_command('90000000-0000-4000-8000-000000000103',jsonb_build_object('type','activity.create','personId',ids[4],'kind','call','summary','Fictional interest confirmed','outcome','interested','nextAction',jsonb_build_object('type','onboarding','dueAt','2026-09-17T14:00:00Z')));
 result:=public.crm_command('90000000-0000-4000-8000-000000000104',jsonb_build_object('type','onboarding.start','personId',ids[4],'templateId','90000000-0000-4000-8000-000000000900','templateVersion',1,'dueAt','2026-09-17T14:00:00Z','items',jsonb_build_array(jsonb_build_object('title','Record consent','required',true)),'blockers',jsonb_build_array('Agreement review')));
 perform public.crm_command('90000000-0000-4000-8000-000000000105',jsonb_build_object('type','activity.create','personId',ids[5],'kind','call','summary','Fictional onboarding conversation','outcome','interested','nextAction',jsonb_build_object('type','onboarding','dueAt','2026-09-17T14:00:00Z')));
 result:=public.crm_command('90000000-0000-4000-8000-000000000106',jsonb_build_object('type','onboarding.start','personId',ids[5],'templateId','90000000-0000-4000-8000-000000000900','templateVersion',1,'dueAt','2026-09-17T14:00:00Z','items',jsonb_build_array(jsonb_build_object('title','Record consent','required',true))));
 onboarding_id:=(result->>'id')::uuid;
 select items->0 into record_item from public.onboarding_cases where id=onboarding_id;
 perform public.crm_command('90000000-0000-4000-8000-000000000107',jsonb_build_object('type','onboarding.item','id',onboarding_id,'expectedRevision',0,'itemId',record_item->>'id'));
 perform public.crm_command('90000000-0000-4000-8000-000000000108',jsonb_build_object('type','onboarding.decide','id',onboarding_id,'expectedRevision',1,'approve',true,'rationale','Fictional approval for development'));
 perform public.crm_command('90000000-0000-4000-8000-000000000109',jsonb_build_object('type','lifecycle.transition','id',ids[7],'expectedRevision',0,'stage','not_interested','reason','Fictional not-a-fit outcome'));
 perform public.crm_command('90000000-0000-4000-8000-000000000110',jsonb_build_object('type','referral.create','referrerId',ids[5],'personId',ids[9],'sourceNote','Fictional introduction with contact permission'));
 perform public.crm_command('90000000-0000-4000-8000-000000000111',jsonb_build_object('type','task.create','personId',ids[5],'title','Monthly relationship review','dueAt','2026-09-15T12:00:00Z','priority','high','recurrence',jsonb_build_object('unit','month','interval',1)));
 perform public.crm_command('90000000-0000-4000-8000-000000000112',jsonb_build_object('type','script.publish','name','Introduction','stage','new','content','Confirm this is a convenient time. Ask about service needs. Agree on a next step.','disclosures','Confirm permission to keep relationship notes.','changeNote','Fictional initial version'));
end; $$;
commit;
