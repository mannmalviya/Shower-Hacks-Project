-- v1 has no sign-in. Onboarding writes go through a server action with the secret key.
-- The one onboarding question is stored on the person.
alter table public.people add column net_worth_guess bigint; -- USD, what the person thinks they are worth

drop table public.onboarding_answers;
