create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- PERFIS DOS CLIENTES E ADMINISTRADOR

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default '',
    phone text not null default '',
    role text not null default 'client'
        check (role in ('client', 'admin')),
    created_at timestamptz not null default now()
);

-- SERVIÇOS

create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    price numeric(10,2) not null check (price >= 0),
    duration_minutes integer not null
        check (duration_minutes between 5 and 600),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

-- HORÁRIOS DE FUNCIONAMENTO

create table if not exists public.business_hours (
    weekday integer primary key check (weekday between 0 and 6),
    is_open boolean not null default false,
    open_time time not null default '09:00',
    close_time time not null default '18:00',
    check (close_time > open_time)
);

-- HORÁRIOS BLOQUEADOS

create table if not exists public.blocked_slots (
    id uuid primary key default gen_random_uuid(),
    start_at timestamptz not null,
    end_at timestamptz not null,
    reason text default '',
    created_at timestamptz not null default now(),
    check (end_at > start_at)
);

-- AGENDAMENTOS

create table if not exists public.appointments (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references public.profiles(id),
    service_id uuid not null references public.services(id),
    start_at timestamptz not null,
    end_at timestamptz not null,
    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
    created_at timestamptz not null default now(),
    check (end_at > start_at)
);

-- EVITAR DOIS AGENDAMENTOS NO MESMO HORÁRIO

alter table public.appointments
drop constraint if exists appointments_no_overlap;

alter table public.appointments
add constraint appointments_no_overlap
exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
)
where (status in ('pending', 'confirmed'));

-- FUNÇÃO PARA VERIFICAR ADMINISTRADOR

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
        and role = 'admin'
    );
$$;

-- CRIAR PERFIL AUTOMATICAMENTE

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    insert into public.profiles (
        id,
        full_name,
        phone
    )
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', ''),
        coalesce(new.raw_user_meta_data->>'phone', '')
    );

    return new;

end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

-- ATIVAR SEGURANÇA

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.business_hours enable row level security;
alter table public.blocked_slots enable row level security;
alter table public.appointments enable row level security;

-- PERFIS

create policy "profiles read"
on public.profiles
for select
to authenticated
using (
    id = auth.uid()
    or public.is_admin()
);

create policy "profiles update own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
    id = auth.uid()
    and role = 'client'
);

-- SERVIÇOS

create policy "services read"
on public.services
for select
to anon, authenticated
using (
    active = true
    or public.is_admin()
);

create policy "services admin"
on public.services
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- HORÁRIOS

create policy "hours read"
on public.business_hours
for select
to anon, authenticated
using (true);

create policy "hours admin"
on public.business_hours
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- BLOQUEIOS

create policy "blocks read"
on public.blocked_slots
for select
to authenticated
using (true);

create policy "blocks admin"
on public.blocked_slots
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- AGENDAMENTOS

create policy "appointments read"
on public.appointments
for select
to authenticated
using (
    customer_id = auth.uid()
    or public.is_admin()
);

create policy "appointments create"
on public.appointments
for insert
to authenticated
with check (
    customer_id = auth.uid()
    and status = 'pending'
);

create policy "appointments admin update"
on public.appointments
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "appointments customer cancel"
on public.appointments
for update
to authenticated
using (
    customer_id = auth.uid()
    and status in ('pending', 'confirmed')
)
with check (
    customer_id = auth.uid()
    and status = 'cancelled'
);

-- HORÁRIOS DISPONÍVEIS

create or replace function public.get_available_slots(
    p_date date,
    p_service_id uuid
)
returns table(slot_time time)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_weekday integer;
    v_open time;
    v_close time;
    v_duration integer;
    v_t time;
    v_start timestamptz;
    v_end timestamptz;
begin

    v_weekday := extract(dow from p_date)::int;

    select open_time, close_time
    into v_open, v_close
    from public.business_hours
    where weekday = v_weekday
    and is_open = true;

    select duration_minutes
    into v_duration
    from public.services
    where id = p_service_id
    and active = true;

    if v_open is null or v_duration is null then
        return;
    end if;

    v_t := v_open;

    while v_t + make_interval(mins => v_duration) <= v_close loop

        v_start := (p_date + v_t)
            at time zone 'America/Sao_Paulo';

        v_end := v_start
            + make_interval(mins => v_duration);

        if v_start > now()

        and not exists (
            select 1
            from public.appointments a
            where a.status in ('pending', 'confirmed')
            and tstzrange(a.start_at, a.end_at, '[)')
                && tstzrange(v_start, v_end, '[)')
        )

        and not exists (
            select 1
            from public.blocked_slots b
            where tstzrange(b.start_at, b.end_at, '[)')
                && tstzrange(v_start, v_end, '[)')
        )

        then
            slot_time := v_t;
            return next;
        end if;

        v_t := v_t + interval '30 minutes';

    end loop;

end;
$$;

-- CRIAR AGENDAMENTO

create or replace function public.create_booking(
    p_service_id uuid,
    p_date date,
    p_time time
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_duration integer;
    v_start timestamptz;
    v_end timestamptz;
    v_id uuid;
    v_weekday integer;
    v_open time;
    v_close time;
begin

    if v_user is null then
        raise exception 'Faça login para agendar.';
    end if;

    select duration_minutes
    into v_duration
    from public.services
    where id = p_service_id
    and active = true;

    if v_duration is null then
        raise exception 'Serviço indisponível.';
    end if;

    v_weekday := extract(dow from p_date)::int;

    select open_time, close_time
    into v_open, v_close
    from public.business_hours
    where weekday = v_weekday
    and is_open = true;

    if v_open is null
       or p_time < v_open
       or p_time + make_interval(mins => v_duration) > v_close then
        raise exception 'Horário fora do funcionamento.';
    end if;

    v_start := (p_date + p_time)
        at time zone 'America/Sao_Paulo';

    v_end := v_start
        + make_interval(mins => v_duration);

    if v_start <= now() then
        raise exception 'Escolha um horário futuro.';
    end if;

    if exists (
        select 1
        from public.blocked_slots b
        where tstzrange(b.start_at, b.end_at, '[)')
            && tstzrange(v_start, v_end, '[)')
    ) then
        raise exception 'Este horário está bloqueado.';
    end if;

    insert into public.appointments (
        customer_id,
        service_id,
        start_at,
        end_at
    )
    values (
        v_user,
        p_service_id,
        v_start,
        v_end
    )
    returning id into v_id;

    return v_id;

exception
    when exclusion_violation then
        raise exception 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;

-- CANCELAR AGENDAMENTO

create or replace function public.cancel_booking(
    p_appointment_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin

    update public.appointments
    set status = 'cancelled'
    where id = p_appointment_id
    and customer_id = auth.uid()
    and status in ('pending', 'confirmed')
    and start_at > now();

    if not found then
        raise exception 'Não foi possível cancelar este agendamento.';
    end if;

end;
$$;

-- HORÁRIOS INICIAIS

insert into public.business_hours (
    weekday,
    is_open,
    open_time,
    close_time
)
values
(0, false, '09:00', '18:00'),
(1, true, '09:00', '18:00'),
(2, true, '09:00', '18:00'),
(3, true, '09:00', '18:00'),
(4, true, '09:00', '18:00'),
(5, true, '09:00', '18:00'),
(6, true, '09:00', '13:00')
on conflict (weekday) do nothing;

-- SERVIÇOS DE EXEMPLO

insert into public.services (
    name,
    price,
    duration_minutes
)
values
('Corte masculino', 35, 30),
('Barba', 25, 30),
('Corte + Barba', 55, 60)
on conflict do nothing;

-- DEPOIS DE CADASTRAR A CONTA DO DONO,
-- EXECUTE ESTE COMANDO TROCANDO O E-MAIL:

-- update public.profiles
-- set role = 'admin'
-- where id = (
--     select id
--     from auth.users
--     where email = 'EMAIL_DO_DONO'
-- );