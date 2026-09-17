begin;
-- A separately committed request limiter counts failed mutations as well as successful ones at the HTTP boundary.
create function public.consume_request_limit(p_scope text) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid; begin
 u:=private.require_ceo();
 if p_scope not in ('mutation','file','read') then raise exception using message='VALIDATION',errcode='P0001'; end if;
 return private.consume_limit(p_scope||':'||u::text,case p_scope when 'file' then 30 when 'mutation' then 120 else 300 end,60);
end; $$;
revoke all on function public.consume_request_limit(text) from public,anon;
grant execute on function public.consume_request_limit(text) to authenticated;
-- Enforce ownership and immutable finalized onboarding decisions even for administrative writes.
create function private.onboarding_final() returns trigger language plpgsql set search_path='' as $$
begin
 if old.decision<>'pending' then raise exception using message='IMMUTABLE_HISTORY',errcode='P0001'; end if;
 return new;
end; $$;
create trigger onboarding_decision_immutable before update on public.onboarding_cases for each row execute function private.onboarding_final();
-- Every user-owned table has RLS even for private internal state; there are no client policies here.
alter table private.ceo_access enable row level security;
alter table private.operations enable row level security;
alter table private.rate_limits enable row level security;
revoke all on function private.onboarding_final() from public,anon,authenticated;
commit;
