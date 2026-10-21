-- ============================================================
-- 1. Ladder Safety Inspection Schema & Seed
-- ============================================================

create table if not exists inspection_points (
  id            int generated always as identity primary key,
  category      text not null check (category in ('general', 'extension', 'step')),
  question      text not null,
  display_order int  not null,
  is_required   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists question_options (
  id            int generated always as identity primary key,
  question_id   int not null references inspection_points(id) on delete cascade,
  option_label  text not null,
  option_value  text not null,
  sort_order    int not null,
  is_fail_value boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists inspections (
  id              uuid primary key default gen_random_uuid(),
  inspector_name  text not null check (length(btrim(inspector_name)) > 0),
  epf_number      text,
  inspection_date date not null default current_date,
  ladder_no       text not null check (length(btrim(ladder_no)) > 0),
  section         text not null check (length(btrim(section)) > 0),
  height_feet     numeric(5, 1) not null check (height_feet > 0),
  ladder_type     text not null check (ladder_type in ('extension', 'step')),
  overall_result  text not null check (overall_result in ('PASS', 'FAIL')),
  remarks         text,
  submission_key  uuid not null unique,
  created_at      timestamptz not null default now()
);

create table if not exists inspection_results (
  id                     bigint generated always as identity primary key,
  inspection_id          uuid not null references inspections (id) on delete cascade,
  inspection_point_id    int  not null references inspection_points (id),
  category_snapshot      text not null,
  question_text_snapshot text not null,
  display_order_snapshot int  not null,
  result                 text not null check (result in ('PASS', 'FAIL', 'N/A')),
  answer_label           text,
  remarks                text,
  created_at             timestamptz not null default now(),
  unique (inspection_id, inspection_point_id),
  check (result <> 'FAIL' or length(btrim(coalesce(remarks, ''))) > 0)
);

create index if not exists inspections_date_idx    on inspections (inspection_date desc);
create index if not exists inspections_ladder_idx  on inspections (ladder_no, inspection_date desc);
create index if not exists inspections_result_idx  on inspections (overall_result);
create index if not exists results_inspection_idx  on inspection_results (inspection_id);

alter table inspection_points  enable row level security;
alter table question_options   enable row level security;
alter table inspections        enable row level security;
alter table inspection_results enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='inspection_points' and policyname='public can read active points') then
    create policy "public can read active points" on inspection_points for select to anon, authenticated using (is_active);
  end if;
  if not exists (select 1 from pg_policies where tablename='question_options' and policyname='public can read options') then
    create policy "public can read options" on question_options for select to anon, authenticated using (is_active);
  end if;
end $$;

revoke all on inspections, inspection_results from anon, authenticated;

create or replace function submit_inspection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key     uuid := (payload->>'submission_key')::uuid;
  v_type    text := payload->>'ladder_type';
  v_id      uuid;
  v_overall text;
  v_missing int;
begin
  select id, overall_result into v_id, v_overall
    from inspections where submission_key = v_key;
  if found then
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  if v_type not in ('extension', 'step') then
    raise exception 'Invalid ladder type';
  end if;

  select count(*) into v_missing
    from inspection_points p
   where p.is_active and p.is_required and p.category in ('general', v_type)
     and not exists (
       select 1
         from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
        where x.point_id = p.id and x.result in ('PASS', 'FAIL', 'N/A'));
  if v_missing > 0 then
    raise exception 'All checklist points must be answered';
  end if;

  select case when exists (
           select 1
             from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
             join inspection_points p on p.id = x.point_id
            where x.result = 'FAIL' and p.is_required)
         then 'FAIL' else 'PASS' end
    into v_overall;

  insert into inspections (inspector_name, epf_number, inspection_date,
                           ladder_no, section, height_feet, ladder_type,
                           overall_result, remarks, submission_key)
  values (
          btrim(payload->>'inspector_name'),
          nullif(btrim(coalesce(payload->>'epf_number', '')), ''),
          coalesce((payload->>'inspection_date')::date, current_date),
          btrim(payload->>'ladder_no'),
          btrim(payload->>'section'),
          (payload->>'height_feet')::numeric,
          v_type,
          v_overall,
          nullif(btrim(coalesce(payload->>'remarks', '')), ''),
          v_key)
  on conflict (submission_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id, overall_result into v_id, v_overall
      from inspections where submission_key = v_key;
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  insert into inspection_results (inspection_id, inspection_point_id, category_snapshot,
                                  question_text_snapshot, display_order_snapshot,
                                  result, remarks)
  select v_id, p.id, p.category, p.question, p.display_order,
         x.result, nullif(btrim(coalesce(x.remarks, '')), '')
    from jsonb_to_recordset(payload->'results') as x(point_id int, result text, remarks text)
    join inspection_points p on p.id = x.point_id
   where p.is_active and p.category in ('general', v_type)
     and x.result in ('PASS', 'FAIL', 'N/A');

  return jsonb_build_object('id', v_id, 'overall_result', v_overall);
end;
$$;

revoke all on function submit_inspection(jsonb) from public;
grant execute on function submit_inspection(jsonb) to anon, authenticated;
