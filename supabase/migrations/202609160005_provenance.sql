begin;
alter table public.people add column source text not null default 'manual' check(source in ('manual','imported','referral','system'));
commit;
