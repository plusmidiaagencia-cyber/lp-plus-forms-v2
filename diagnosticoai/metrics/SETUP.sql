-- ============================================================
-- Plus Mídia — Funil do Diagnóstico ECOM | métricas first-party
-- Rode 1x no Supabase do GPM: SQL Editor → cole tudo → Run.
-- Projeto: rkngilknpcibcwalropj
-- ============================================================

create table if not exists public.lp_funnel_events (
  id          bigint generated always as identity primary key,
  session_id  text not null,
  source      text not null default 'quiz-diagnostico',
  step        text not null,
  step_index  int,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists lp_funnel_events_step_idx    on public.lp_funnel_events (step);
create index if not exists lp_funnel_events_created_idx  on public.lp_funnel_events (created_at);
create index if not exists lp_funnel_events_session_idx  on public.lp_funnel_events (session_id);

-- RLS: anon SÓ INSERE (não lê linhas cruas).
alter table public.lp_funnel_events enable row level security;

drop policy if exists lp_funnel_insert_anon on public.lp_funnel_events;
create policy lp_funnel_insert_anon on public.lp_funnel_events
  for insert to anon, authenticated with check (true);

-- privilégio de INSERT (RLS faz o gating; sem SELECT pro anon).
grant insert on public.lp_funnel_events to anon, authenticated;

-- Métricas agregadas (sessões únicas por etapa). security definer = lê a tabela
-- ignorando o RLS, mas devolve SÓ contagens — nenhuma linha crua é exposta.
create or replace function public.lp_funnel_metrics(p_source text default null, p_days int default 30)
returns table(step text, step_index int, sessions bigint, events bigint, icp_sessions bigint)
language sql
security definer
set search_path = public
as $$
  select
    step,
    max(step_index)                                              as step_index,
    count(distinct session_id)                                   as sessions,
    count(*)                                                     as events,
    count(distinct session_id) filter (where meta->>'icp' = 'true') as icp_sessions
  from public.lp_funnel_events
  where (p_source is null or source = p_source)
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by step
  order by max(step_index) nulls last, step;
$$;

grant execute on function public.lp_funnel_metrics(text, int) to anon, authenticated;

-- ============================================================
-- Tabela por sessão (cada visitante numa linha). SEM PII —
-- só respostas do quiz, última etapa e status. security definer.
-- ============================================================
create or replace function public.lp_funnel_sessions(
  p_source text default null, p_days int default 30, p_only_completed boolean default false
)
returns table(
  session_id text, started_at timestamptz, last_step text, last_index int,
  steps_count int, completed boolean, is_lead boolean, icp boolean,
  segmento text, volume text, trafego text, faturamento text
)
language sql security definer set search_path = public as $$
  with ev as (
    select * from public.lp_funnel_events
    where (p_source is null or source = p_source)
      and created_at >= now() - make_interval(days => greatest(p_days,1))
  )
  select
    session_id,
    min(created_at) as started_at,
    (array_agg(step order by created_at desc))[1] as last_step,
    max(step_index) as last_index,
    count(*)::int as steps_count,
    bool_or(step='result') as completed,
    bool_or(step='lead')   as is_lead,
    bool_or(meta->>'icp'='true') as icp,
    max(meta->>'v') filter (where step='q_segmento')    as segmento,
    max(meta->>'v') filter (where step='q_volume')      as volume,
    max(meta->>'v') filter (where step='q_trafego')     as trafego,
    max(meta->>'v') filter (where step='q_faturamento') as faturamento
  from ev
  group by session_id
  having (not p_only_completed) or bool_or(step='result')
  order by min(created_at) desc
  limit 1000;
$$;

grant execute on function public.lp_funnel_sessions(text, int, boolean) to anon, authenticated;
