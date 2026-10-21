-- ============================================================
-- Fire Extinguisher Inspection: OPTIMIZED schema
-- Doc: SML/HSE/CL/21
-- ============================================================

create table fire_inspection_points (
  id            int generated always as identity primary key,
  question      text not null,
  display_order int  not null,
  is_required   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table fire_question_options (
  id            int generated always as identity primary key,
  question_id   int not null references fire_inspection_points(id) on delete cascade,
  option_label  text not null,
  option_value  text not null check (length(btrim(option_value)) > 0),
  sort_order    int not null,
  is_fail_value boolean not null default false,
  is_active     boolean not null default true,
  unique (question_id, option_value)
);

create table fire_inspections (
  id                uuid primary key default gen_random_uuid(),
  inspector_name    text not null check (length(btrim(inspector_name)) > 0),
  epf_number        text,
  inspection_date   date not null default current_date,
  point_no          text not null check (length(btrim(point_no)) > 0),
  location          text not null check (length(btrim(location)) > 0),
  quantity          text not null check (length(btrim(quantity)) > 0),
  extinguisher_type text not null check (length(btrim(extinguisher_type)) > 0),
  pressure_weight   text not null default '',
  overall_result    text not null check (overall_result in ('PASS', 'FAIL')),
  remarks           text,
  submission_key    uuid not null unique,
  created_at        timestamptz not null default now()
);

create table fire_inspection_results (
  id                     bigint generated always as identity primary key,
  inspection_id          uuid not null references fire_inspections (id) on delete cascade,
  inspection_point_id    int  not null references fire_inspection_points (id),
  question_text_snapshot text not null,
  display_order_snapshot int  not null,
  result                 text not null check (result in ('PASS', 'FAIL')),
  answer_label           text,
  remarks                text,
  created_at             timestamptz not null default now(),
  unique (inspection_id, inspection_point_id),
  check (result = 'PASS' or length(btrim(coalesce(remarks, ''))) > 0)
);

create index fire_inspections_date_idx    on fire_inspections (inspection_date desc);
create index fire_inspections_point_idx   on fire_inspections (point_no, inspection_date desc);
create index fire_inspections_result_idx  on fire_inspections (overall_result);
create index fire_results_inspection_idx  on fire_inspection_results (inspection_id);

-- Row Level Security
alter table fire_inspection_points  enable row level security;
alter table fire_question_options   enable row level security;
alter table fire_inspections        enable row level security;
alter table fire_inspection_results enable row level security;

create policy "public can read active points"
  on fire_inspection_points for select to anon, authenticated
  using (is_active);

create policy "public can read options"
  on fire_question_options for select to anon, authenticated
  using (is_active);

revoke all on fire_inspections, fire_inspection_results from anon, authenticated;

-- Atomic submit function
create or replace function submit_fire_inspection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key     uuid := (payload->>'submission_key')::uuid;
  v_id      uuid;
  v_overall text;
  v_missing int;
begin
  select id, overall_result into v_id, v_overall
    from fire_inspections where submission_key = v_key;
  if found then
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  select count(*) into v_missing
    from fire_inspection_points p
   where p.is_active and p.is_required
     and not exists (
       select 1
         from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
        where x.point_id = p.id);
  if v_missing > 0 then
    raise exception 'All checklist points must be answered';
  end if;

  select case when exists (
           select 1
             from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
             join fire_question_options o on o.question_id = x.point_id and o.option_value = x.result
             join fire_inspection_points p on p.id = x.point_id
            where o.is_fail_value = true and p.is_required)
         then 'FAIL' else 'PASS' end
    into v_overall;

  insert into fire_inspections (inspector_name, epf_number, inspection_date,
                                point_no, location, quantity, extinguisher_type, pressure_weight,
                                overall_result, remarks, submission_key)
  values (
          btrim(payload->>'inspector_name'),
          nullif(btrim(coalesce(payload->>'epf_number', '')), ''),
          coalesce((payload->>'inspection_date')::date, current_date),
          btrim(payload->>'point_no'),
          btrim(payload->>'location'),
          btrim(payload->>'quantity'),
          btrim(payload->>'extinguisher_type'),
          btrim(payload->>'pressure_weight'),
          v_overall,
          nullif(btrim(coalesce(payload->>'remarks', '')), ''),
          v_key)
  on conflict (submission_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id, overall_result into v_id, v_overall
      from fire_inspections where submission_key = v_key;
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  insert into fire_inspection_results (inspection_id, inspection_point_id,
                                       question_text_snapshot, display_order_snapshot,
                                       result, answer_label, remarks)
  select v_id, p.id, p.question, p.display_order,
         x.result, o.option_label, nullif(btrim(coalesce(x.remarks, '')), '')
    from jsonb_to_recordset(payload->'results') as x(point_id int, result text, remarks text)
    join fire_inspection_points p on p.id = x.point_id
    left join fire_question_options o on o.question_id = p.id and o.option_value = x.result
   where p.is_active;

  return jsonb_build_object('id', v_id, 'overall_result', v_overall);
end;
$$;

revoke all on function submit_fire_inspection(jsonb) from public;
grant execute on function submit_fire_inspection(jsonb) to anon, authenticated;
