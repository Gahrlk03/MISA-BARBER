-- MISA BARBER: estrutura inicial dos planos mensais
-- Execute este arquivo no SQL Editor do Supabase.
-- Esta migration é aditiva: não altera tabelas, funções ou políticas existentes.

create table if not exists public.membership_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text not null default '',
    monthly_price numeric(10,2) not null check (monthly_price >= 0),
    cuts_per_month integer not null check (cuts_per_month > 0),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.customer_subscriptions (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references public.profiles(id) on delete cascade,
    plan_id uuid not null references public.membership_plans(id),
    starts_on date not null,
    ends_on date not null,
    cuts_total integer not null check (cuts_total > 0),
    cuts_used integer not null default 0 check (cuts_used >= 0),
    status text not null default 'pending'
        check (status in ('pending', 'active', 'expired', 'cancelled')),
    payment_status text not null default 'pending'
        check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
    created_at timestamptz not null default now(),
    check (ends_on >= starts_on),
    check (cuts_used <= cuts_total)
);

alter table public.membership_plans enable row level security;
alter table public.customer_subscriptions enable row level security;

drop policy if exists "membership plans read" on public.membership_plans;
create policy "membership plans read"
on public.membership_plans
for select
to anon, authenticated
using (active = true or public.is_admin());

drop policy if exists "membership plans admin" on public.membership_plans;
create policy "membership plans admin"
on public.membership_plans
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "subscriptions read own or admin" on public.customer_subscriptions;
create policy "subscriptions read own or admin"
on public.customer_subscriptions
for select
to authenticated
using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "subscriptions admin manage" on public.customer_subscriptions;
create policy "subscriptions admin manage"
on public.customer_subscriptions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- A criação/ativação pelo cliente será ligada ao checkout quando o pagamento
-- estiver integrado. Até lá, somente o barbeiro pode ativar assinaturas.
