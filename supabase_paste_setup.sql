-- Supabase setup for the Ladder Inspection Checklist.
-- Paste this whole file into Supabase SQL Editor and run it.

create extension if not exists pgcrypto;

create table if not exists checklist_documents (
  id                   int generated always as identity primary key,
  doc_no               text not null,
  title                text not null,
  issued_date          date,
  revision             text,
  prepared_reviewed_by text,
  approved_by          text,
  page_no              text,
  source_file          text,
  is_current           boolean not null default true,
  created_at           timestamptz not null default now()
);

alter table checklist_documents
  add column if not exists page_no text,
  add column if not exists source_file text;

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

create table if not exists checklist_reference_images (
  id                    int generated always as identity primary key,
  checklist_document_id int references checklist_documents (id) on delete cascade,
  title                 text not null,
  image_path            text not null,
  alt_text              text,
  display_order         int not null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists inspections (
  id                    uuid primary key default gen_random_uuid(),
  checklist_document_id int references checklist_documents (id),
  inspector_name        text not null check (length(btrim(inspector_name)) > 0),
  inspection_date       date not null default current_date,
  ladder_no             text not null check (length(btrim(ladder_no)) > 0),
  section               text not null check (length(btrim(section)) > 0),
  height_feet           numeric(5, 1) not null check (height_feet > 0),
  ladder_type           text not null check (ladder_type in ('extension', 'step')),
  overall_result        text not null check (overall_result in ('PASS', 'FAIL')),
  remarks               text,
  submission_key        uuid not null unique,
  created_at            timestamptz not null default now()
);

create table if not exists inspection_results (
  id                     bigint generated always as identity primary key,
  inspection_id          uuid not null references inspections (id) on delete cascade,
  inspection_point_id    int  not null references inspection_points (id),
  category_snapshot      text not null,
  question_text_snapshot text not null,
  display_order_snapshot int  not null,
  result                 text not null check (result in ('PASS', 'FAIL', 'N/A')),
  remarks                text,
  created_at             timestamptz not null default now(),
  unique (inspection_id, inspection_point_id),
  check (result <> 'FAIL' or length(btrim(coalesce(remarks, ''))) > 0)
);

create index if not exists inspections_date_idx
  on inspections (inspection_date desc);
create index if not exists inspections_ladder_idx
  on inspections (ladder_no, inspection_date desc);
create index if not exists inspections_result_idx
  on inspections (overall_result);
create index if not exists results_inspection_idx
  on inspection_results (inspection_id);
create index if not exists inspection_points_category_order_idx
  on inspection_points (category, display_order);
create index if not exists checklist_reference_images_order_idx
  on checklist_reference_images (display_order);

alter table checklist_documents enable row level security;
alter table inspection_points enable row level security;
alter table checklist_reference_images enable row level security;
alter table inspections enable row level security;
alter table inspection_results enable row level security;

drop policy if exists "public can read current document" on checklist_documents;
create policy "public can read current document"
  on checklist_documents for select to anon, authenticated
  using (is_current);

drop policy if exists "public can read active points" on inspection_points;
create policy "public can read active points"
  on inspection_points for select to anon, authenticated
  using (is_active);

drop policy if exists "public can read active reference images" on checklist_reference_images;
create policy "public can read active reference images"
  on checklist_reference_images for select to anon, authenticated
  using (is_active);

grant select on checklist_documents to anon, authenticated;
grant select on inspection_points to anon, authenticated;
grant select on checklist_reference_images to anon, authenticated;
revoke all on inspections, inspection_results from anon, authenticated;

-- Current source document from LADDER- CHECKLIST.xlsx.
insert into checklist_documents (
  doc_no,
  title,
  issued_date,
  revision,
  prepared_reviewed_by,
  approved_by,
  page_no,
  source_file,
  is_current
)
select
  'SML/HSE/CL/10',
  'LADDER- CHECKLIST',
  date '2026-03-20',
  '00/00.00.0000',
  'Management Representative',
  'Managing Director',
  'Page 1 of 2',
  'LADDER- CHECKLIST.xlsx',
  true
where not exists (
  select 1
    from checklist_documents
   where doc_no = 'SML/HSE/CL/10'
     and title = 'LADDER- CHECKLIST'
     and is_current = true
);

-- Keep existing current document metadata up to date if it was already inserted.
update checklist_documents
   set issued_date = date '2026-03-20',
       revision = '00/00.00.0000',
       prepared_reviewed_by = 'Management Representative',
       approved_by = 'Managing Director',
       page_no = 'Page 1 of 2',
       source_file = 'LADDER- CHECKLIST.xlsx'
 where doc_no = 'SML/HSE/CL/10'
   and title = 'LADDER- CHECKLIST'
   and is_current = true;

-- 24 checklist points: 15 general, 5 extension ladder, 4 step ladder.
insert into inspection_points (category, question, display_order)
select *
from (values
  ('general',   'Ladder number available', 1),
  ('general',   'All the rungs, cleats, or steps are in good condition (Broken, missing, bend rungs)', 2),
  ('general',   'Side rails is intact without any cracks, bends, or breaks.', 3),
  ('general',   'The rungs, cleats, or steps is fit into the side rails without damage.', 4),
  ('general',   'Ladder is free from corrosion.', 5),
  ('general',   'Side rails and steps are free from oil or grease.', 6),
  ('general',   'Rungs are placed at regular intervals (30 cm gap between two rungs)', 7),
  ('general',   'Projection of loose nails, screws, bolts, or other metal parts', 8),
  ('general',   'At the time of using, the ladder should be placed at 65-75 degree angle (1(Horizontal):4 (Vertical) ratio).', 9),
  ('general',   'Ladder is extended at least 1m above the landing platform (3 Rungs). If ladder is in wall then somebody should hold at bottom.', 10),
  ('general',   'Ladder is secured either at top or at the bottom', 11),
  ('general',   'Ladder rungs should not be painted.', 12),
  ('general',   'Reinforcement rod should not be used as ladder rungs', 13),
  ('general',   'The surface of the rungs should not be smooth', 14),
  ('general',   'Rubber feet for firm grip (in case of Aluminum ladder)', 15),
  ('extension', 'Loose, missing or broken extension locks', 16),
  ('extension', 'Defective locks which do not seat properly when ladder is extended. Pulley, Rope, lock, and sliding arrangement must be in proper working condition.', 17),
  ('extension', 'Loose hinges', 18),
  ('extension', 'Three arms over lap is required.', 19),
  ('extension', 'Ensure stopper without damage', 20),
  ('step',      'Step ladder height should not to exceed by 20 feet.', 21),
  ('step',      'Loose hinges', 22),
  ('step',      'Loose or bent hinge spreaders', 23),
  ('step',      'Ensure Spreader without damage and locking Mechanism', 24)
) as seed(category, question, display_order)
where not exists (
  select 1
    from inspection_points p
   where p.category = seed.category
     and p.display_order = seed.display_order
);

-- Image references used by the form. Upload/copy these files to the same paths
-- in your app or Supabase Storage if you want to serve them from Supabase.
insert into checklist_reference_images (
  checklist_document_id,
  title,
  image_path,
  alt_text,
  display_order
)
select d.id, seed.title, seed.image_path, seed.alt_text, seed.display_order
from checklist_documents d
cross join (values
  (
    'SML logo',
    'assets/checklist/image1.png',
    'SML logo',
    1
  ),
  (
    'Isuzu logo',
    'assets/checklist/image2.jpeg',
    'Isuzu logo',
    2
  ),
  (
    'Ladder work-at-height procedure',
    'assets/checklist/image3.png',
    'Workbook reference page for ladder operation control procedure',
    3
  ),
  (
    'Extension ladder angle and stepladder guidance',
    'assets/checklist/image4.png',
    'Workbook reference page showing ladder angle, 3-point rule, 4 to 1 ratio, and stepladder guidance',
    4
  ),
  (
    'Working-at-height reference',
    'assets/checklist/image5.png',
    'Workbook reference page for working at height requirements',
    5
  )
) as seed(title, image_path, alt_text, display_order)
where d.doc_no = 'SML/HSE/CL/10'
  and d.title = 'LADDER- CHECKLIST'
  and d.is_current = true
  and not exists (
    select 1
      from checklist_reference_images r
     where r.checklist_document_id = d.id
       and r.display_order = seed.display_order
  );

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
  v_doc     int;
  v_missing int;
begin
  select id, overall_result into v_id, v_overall
    from inspections
   where submission_key = v_key;

  if found then
    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  if v_type not in ('extension', 'step') then
    raise exception 'Invalid ladder type';
  end if;

  select count(*) into v_missing
    from inspection_points p
   where p.is_active
     and p.is_required
     and p.category in ('general', v_type)
     and not exists (
       select 1
         from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
        where x.point_id = p.id
          and x.result in ('PASS', 'FAIL', 'N/A')
     );

  if v_missing > 0 then
    raise exception 'All checklist points must be answered';
  end if;

  select case when exists (
           select 1
             from jsonb_to_recordset(payload->'results') as x(point_id int, result text)
             join inspection_points p on p.id = x.point_id
            where x.result = 'FAIL'
              and p.is_required
         )
         then 'FAIL' else 'PASS' end
    into v_overall;

  select id into v_doc
    from checklist_documents
   where is_current
   order by id desc
   limit 1;

  insert into inspections (
    checklist_document_id,
    inspector_name,
    inspection_date,
    ladder_no,
    section,
    height_feet,
    ladder_type,
    overall_result,
    remarks,
    submission_key
  )
  values (
    v_doc,
    btrim(payload->>'inspector_name'),
    coalesce((payload->>'inspection_date')::date, current_date),
    btrim(payload->>'ladder_no'),
    btrim(payload->>'section'),
    (payload->>'height_feet')::numeric,
    v_type,
    v_overall,
    nullif(btrim(coalesce(payload->>'remarks', '')), ''),
    v_key
  )
  on conflict (submission_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id, overall_result into v_id, v_overall
      from inspections
     where submission_key = v_key;

    return jsonb_build_object('id', v_id, 'overall_result', v_overall);
  end if;

  insert into inspection_results (
    inspection_id,
    inspection_point_id,
    category_snapshot,
    question_text_snapshot,
    display_order_snapshot,
    result,
    remarks
  )
  select
    v_id,
    p.id,
    p.category,
    p.question,
    p.display_order,
    x.result,
    nullif(btrim(coalesce(x.remarks, '')), '')
  from jsonb_to_recordset(payload->'results') as x(point_id int, result text, remarks text)
  join inspection_points p on p.id = x.point_id
  where p.is_active
    and p.category in ('general', v_type)
    and x.result in ('PASS', 'FAIL', 'N/A');

  return jsonb_build_object('id', v_id, 'overall_result', v_overall);
end;
$$;

revoke all on function submit_inspection(jsonb) from public;
grant execute on function submit_inspection(jsonb) to anon, authenticated;
