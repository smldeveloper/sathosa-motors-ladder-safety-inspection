-- ============================================================
-- First Aid Box Monthly Checklist: OPTIMIZED schema
-- Doc: SML/HSE/CL/06  |  Replaces 0005_firstaid_schema.sql
-- Changes vs original:
--   - Removed firstaid_checklist_documents (single static row, never queried)
--   - Removed question_type column (always 'decision', never used)
--   - Removed allow_remarks column (always true, never checked)
--   - Removed category column from inspection_points (always 'firstaid', redundant)
--   - Added CHECK constraint on result values
--   - Added CHECK: FAIL/EXPIRED result must have a remark
--   - Fixed epf_number to store NULL instead of empty string
-- ============================================================

create table firstaid_inspection_points (
  id            int  generated always as identity primary key,
  question      text not null,
  display_order int  not null,
  is_required   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table firstaid_question_options (
  id            int  generated always as identity primary key,
  question_id   int  not null references firstaid_inspection_points(id) on delete cascade,
  option_label  text not null,
  option_value  text not null  check (length(btrim(option_value)) > 0),
  sort_order    int  not null,
  is_fail_value boolean not null default false,
  is_active     boolean not null default true,
  unique (question_id, option_value)         -- no duplicate options per question
);

create table firstaid_inspections (
  id              uuid    primary key default gen_random_uuid(),
  inspector_name  text    not null check (length(btrim(inspector_name)) > 0),
  epf_number      text,                      -- nullable; empty string coerced to NULL in submit fn
  inspection_date date    not null default current_date,
  box_no          text    not null check (length(btrim(box_no)) > 0),
  location        text    not null check (length(btrim(location)) > 0),
  overall_result  text    not null check (overall_result in ('PASS', 'FAIL')),
  remarks         text,
  submission_key  uuid    not null unique,
  created_at      timestamptz not null default now()
);

create table firstaid_inspection_results (
  id                     bigint generated always as identity primary key,
  inspection_id          uuid   not null references firstaid_inspections (id) on delete cascade,
  inspection_point_id    int    not null references firstaid_inspection_points (id),
  question_text_snapshot text   not null,   -- survives future question edits
  display_order_snapshot int    not null,
  result                 text   not null check (result in ('PASS', 'FAIL', 'EXPIRED')),
  answer_label           text,
  remarks                text,
  created_at             timestamptz not null default now(),
  unique (inspection_id, inspection_point_id),
  -- Remark required whenever an item is flagged as missing or expired
  check (result = 'PASS' or length(btrim(coalesce(remarks, ''))) > 0)
);

-- Indexes
create index firstaid_insp_date_idx   on firstaid_inspections (inspection_date desc);
create index firstaid_insp_box_idx    on firstaid_inspections (box_no, inspection_date desc);
create index firstaid_insp_result_idx on firstaid_inspections (overall_result);
create index firstaid_res_insp_idx    on firstaid_inspection_results (inspection_id);

-- Row Level Security
alter table firstaid_inspection_points  enable row level security;
alter table firstaid_question_options   enable row level security;
alter table firstaid_inspections        enable row level security;
alter table firstaid_inspection_results enable row level security;

create policy "public read active firstaid points"
  on firstaid_inspection_points for select to anon, authenticated using (is_active);

create policy "public read firstaid options"
  on firstaid_question_options for select to anon, authenticated using (is_active);

-- Inspections are write-only from public; only accessible via submit function
revoke all on firstaid_inspections, firstaid_inspection_results from anon, authenticated;

-- ============================================================
-- Atomic submit function
-- ============================================================
create or replace function submit_firstaid_inspection(payload jsonb)
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
  -- Idempotency: duplicate submission returns existing record
  select id, overall_result into v_id, v_overall
    from firstaid_inspections where submission_key = v_key;
  if found then
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  -- All required points must be present in the payload
  select count(*) into v_missing
    from firstaid_inspection_points p
   where p.is_active and p.is_required
     and not exists (
       select 1
         from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
        where x.point_id = p.id);
  if v_missing > 0 then
    raise exception 'All required checklist items must be answered (% missing)', v_missing;
  end if;

  -- Overall result = FAIL if any required item has is_fail_value = true
  select case
    when exists (
      select 1
        from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
        join firstaid_question_options o on o.question_id = x.point_id
                                       and o.option_value = x.result
                                       and o.is_fail_value = true
        join firstaid_inspection_points p on p.id = x.point_id and p.is_required
    ) then 'FAIL'
    else 'PASS'
  end into v_overall;

  insert into firstaid_inspections (
    inspector_name, epf_number, inspection_date,
    box_no, location, overall_result, remarks, submission_key
  )
  values (
    btrim(payload->>'inspector_name'),
    nullif(btrim(coalesce(payload->>'epf_number', '')), ''),  -- empty → NULL
    coalesce((payload->>'inspection_date')::date, current_date),
    btrim(payload->>'box_no'),
    btrim(payload->>'location'),
    v_overall,
    nullif(btrim(coalesce(payload->>'remarks', '')), ''),
    v_key
  )
  on conflict (submission_key) do nothing
  returning id into v_id;

  -- Race condition: another connection committed the same key first
  if v_id is null then
    select id, overall_result into v_id, v_overall
      from firstaid_inspections where submission_key = v_key;
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  insert into firstaid_inspection_results (
    inspection_id, inspection_point_id,
    question_text_snapshot, display_order_snapshot,
    result, answer_label, remarks
  )
  select
    v_id,
    p.id,
    p.question,
    p.display_order,
    x.result,
    o.option_label,
    nullif(btrim(coalesce(x.remarks, '')), '')
  from jsonb_to_recordset(payload->'results') as x(point_id int, result text, remarks text)
  join  firstaid_inspection_points p  on p.id = x.point_id and p.is_active
  left join firstaid_question_options o on o.question_id = p.id and o.option_value = x.result;

  return jsonb_build_object('id', v_id, 'overall_result', v_overall);
end;
$$;

revoke all  on function submit_firstaid_inspection(jsonb) from public;
grant execute on function submit_firstaid_inspection(jsonb) to anon, authenticated;
