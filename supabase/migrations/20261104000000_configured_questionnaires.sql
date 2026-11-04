-- Information fields and checklist points share the admin's active/required settings.
-- Optional or disabled information fields store NULL instead of invented answers.
alter table public.inspections
  alter column inspector_name drop not null, alter column epf_number drop not null, alter column ladder_no drop not null,
  alter column section drop not null, alter column height_feet drop not null,
  alter column ladder_type drop not null;
alter table public.fire_inspections
  alter column inspector_name drop not null, alter column epf_number drop not null, alter column point_no drop not null,
  alter column location drop not null, alter column quantity drop not null,
  alter column extinguisher_type drop not null, alter column pressure_weight drop not null;
alter table public.firstaid_inspections
  alter column inspector_name drop not null, alter column epf_number drop not null, alter column box_no drop not null,
  alter column location drop not null;

create or replace function public.inspection_payload_field(inspection_mode text, field_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when field_key in ('inspector_name', 'epf_number', 'inspection_date') then field_key
    when inspection_mode = 'ladder' and field_key in ('ladder_no', 'section', 'height_feet', 'ladder_type') then field_key
    when inspection_mode = 'fire' then case field_key
      when 'ladder_no' then 'point_no' when 'section' then 'location'
      when 'ladder_type' then 'extinguisher_type'
      when 'point_no' then 'point_no' when 'location' then 'location'
      when 'extinguisher_type' then 'extinguisher_type'
      when 'quantity' then 'quantity' when 'pressure_weight' then 'pressure_weight' end
    when inspection_mode = 'firstaid' then case field_key
      when 'ladder_no' then 'box_no' when 'section' then 'location'
      when 'box_no' then 'box_no' when 'location' then 'location' end
  end;
$$;

create or replace function public.get_inspection_questionnaire(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  inspection_mode text := coalesce(payload->>'mode', 'ladder');
  points_table text;
  options_table text;
  configured jsonb;
begin
  case inspection_mode
    when 'ladder' then points_table := 'inspection_points'; options_table := 'question_options';
    when 'fire' then points_table := 'fire_inspection_points'; options_table := 'fire_question_options';
    when 'firstaid' then points_table := 'firstaid_inspection_points'; options_table := 'firstaid_question_options';
    else raise exception 'Invalid inspection mode';
  end case;
  -- Inactive information-field settings are needed to hide previously hard-coded controls.
  -- Inactive checklist content is never returned to the public form.
  execute format($query$
    select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('options', (
      select coalesce(jsonb_agg(to_jsonb(o) order by o.sort_order, o.id), '[]'::jsonb)
      from public.%I o where o.question_id = p.id and o.is_active
    )) order by p.display_order, p.id), '[]'::jsonb)
    from public.%I p where p.is_active or p.category in ('section_1', 'section_2')
  $query$, options_table, points_table) into configured;
  return jsonb_build_object('mode', inspection_mode,
    -- Legacy rows can contain duplicate bindings. The most recently edited setting wins.
    'fields', (select coalesce(jsonb_agg(latest.q order by (latest.q->>'display_order')::integer), '[]'::jsonb) from (
      select distinct on (public.inspection_payload_field(inspection_mode, q->>'field_key')) q
      from jsonb_array_elements(configured) q
      where q->>'category' in ('section_1', 'section_2') and public.inspection_payload_field(inspection_mode, q->>'field_key') is not null
      order by public.inspection_payload_field(inspection_mode, q->>'field_key'), (q->>'updated_at')::timestamptz desc nulls last, (q->>'id')::integer desc
    ) latest),
    'questions', (select coalesce(jsonb_agg(q), '[]'::jsonb) from jsonb_array_elements(configured) q where coalesce(q->>'category', '') not in ('section_1', 'section_2') and (q->>'is_active')::boolean));
end;
$$;

create or replace function public.submit_configured_inspection(inspection_mode text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  points_table text;
  options_table text;
  inspections_table text;
  results_table text;
  config jsonb;
  field jsonb;
  question jsonb;
  answer jsonb;
  choice jsonb;
  settings jsonb := '{}'::jsonb;
  valid_answers jsonb := '[]'::jsonb;
  field_name text;
  legacy_required text[];
  v_submission_key uuid := (payload->>'submission_key')::uuid;
  inspection_id uuid;
  overall text := 'PASS';
  is_failure boolean;
begin
  case inspection_mode
    when 'ladder' then
      points_table := 'inspection_points'; options_table := 'question_options'; inspections_table := 'inspections'; results_table := 'inspection_results';
      legacy_required := array['inspector_name', 'ladder_no', 'section', 'height_feet', 'ladder_type'];
    when 'fire' then
      points_table := 'fire_inspection_points'; options_table := 'fire_question_options'; inspections_table := 'fire_inspections'; results_table := 'fire_inspection_results';
      legacy_required := array['inspector_name', 'point_no', 'location', 'quantity', 'extinguisher_type'];
    when 'firstaid' then
      points_table := 'firstaid_inspection_points'; options_table := 'firstaid_question_options'; inspections_table := 'firstaid_inspections'; results_table := 'firstaid_inspection_results';
      legacy_required := array['inspector_name', 'box_no', 'location'];
    else raise exception 'Invalid inspection mode';
  end case;
  if v_submission_key is null then raise exception 'Submission key is required'; end if;
  execute format('select id, overall_result from public.%I where submission_key=$1', inspections_table)
    into inspection_id, overall using v_submission_key;
  if inspection_id is not null then return jsonb_build_object('id', inspection_id, 'overall_result', overall); end if;
  overall := 'PASS';
  config := public.get_inspection_questionnaire(jsonb_build_object('mode', inspection_mode));
  for field in select value from jsonb_array_elements(config->'fields') loop
    field_name := public.inspection_payload_field(inspection_mode, field->>'field_key');
    if field_name is null then continue; end if;
    settings := settings || jsonb_build_object(field_name, field);
    if not (field->>'is_active')::boolean then
      payload := payload || jsonb_build_object(field_name, null);
    elsif (field->>'is_required')::boolean and nullif(btrim(payload->>field_name), '') is null then
      raise exception '% is required', field->>'question';
    elsif nullif(btrim(payload->>field_name), '') is not null and jsonb_array_length(field->'options') > 0
      and not exists (select 1 from jsonb_array_elements(field->'options') o where o->>'option_value' = payload->>field_name) then
      raise exception 'Invalid value for %', field->>'question';
    end if;
  end loop;
  foreach field_name in array legacy_required loop
    if not (settings ? field_name) and nullif(btrim(payload->>field_name), '') is null then raise exception '% is required', field_name; end if;
  end loop;
  if inspection_mode = 'ladder' and nullif(payload->>'ladder_type', '') is not null and payload->>'ladder_type' not in ('extension', 'step') then raise exception 'Invalid ladder type'; end if;
  if jsonb_typeof(coalesce(payload->'results', '[]'::jsonb)) <> 'array' then raise exception 'Results must be an array'; end if;

  -- Validate only currently active checklist points. Information fields are validated above.
  for question in select value from jsonb_array_elements(config->'questions') loop
    if inspection_mode = 'ladder' and question->>'category' not in ('general', coalesce(payload->>'ladder_type', '')) then continue; end if;
    select value into answer from jsonb_array_elements(coalesce(payload->'results', '[]'::jsonb)) a where a->>'point_id' = question->>'id' limit 1;
    if answer is null or nullif(btrim(answer->>'result'), '') is null then
      if (question->>'is_required')::boolean then raise exception 'Answer required: %', question->>'question'; end if;
      continue;
    end if;
    select value into choice from jsonb_array_elements(question->'options') o where o->>'option_value' = answer->>'result' limit 1;
    if choice is null then raise exception 'Invalid answer: %', question->>'question'; end if;
    is_failure := coalesce((choice->>'is_fail_value')::boolean, false) or answer->>'result' in ('FAIL', 'EXPIRED');
    if is_failure and nullif(btrim(answer->>'remarks'), '') is null then raise exception 'A remark is required: %', question->>'question'; end if;
    if is_failure then overall := 'FAIL'; end if;
    valid_answers := valid_answers || jsonb_build_array(jsonb_build_object(
      'point_id', question->'id', 'question', question->>'question', 'category', question->>'category',
      'display_order', question->'display_order', 'result', case when answer->>'result' in ('PASS', 'FAIL', 'N/A', 'EXPIRED') then answer->>'result' when is_failure then 'FAIL' else 'PASS' end,
      'answer_label', choice->>'option_label', 'remarks', nullif(btrim(answer->>'remarks'), '')));
  end loop;

  if inspection_mode = 'ladder' then
    insert into public.inspections (inspector_name, epf_number, inspection_date, ladder_no, section, height_feet, ladder_type, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), coalesce(nullif(payload->>'inspection_date', '')::date, current_date),
      nullif(btrim(payload->>'ladder_no'), ''), nullif(btrim(payload->>'section'), ''), nullif(payload->>'height_feet', '')::numeric,
      nullif(payload->>'ladder_type', ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  elsif inspection_mode = 'fire' then
    insert into public.fire_inspections (inspector_name, epf_number, inspection_date, point_no, location, quantity, extinguisher_type, pressure_weight, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), coalesce(nullif(payload->>'inspection_date', '')::date, current_date),
      nullif(btrim(payload->>'point_no'), ''), nullif(btrim(payload->>'location'), ''), nullif(btrim(payload->>'quantity'), ''),
      nullif(btrim(payload->>'extinguisher_type'), ''), nullif(btrim(payload->>'pressure_weight'), ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  else
    insert into public.firstaid_inspections (inspector_name, epf_number, inspection_date, box_no, location, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), coalesce(nullif(payload->>'inspection_date', '')::date, current_date),
      nullif(btrim(payload->>'box_no'), ''), nullif(btrim(payload->>'location'), ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  end if;
  if inspection_id is null then
    execute format('select id, overall_result from public.%I where submission_key=$1', inspections_table) into inspection_id, overall using v_submission_key;
    return jsonb_build_object('id', inspection_id, 'overall_result', overall);
  end if;
  for answer in select value from jsonb_array_elements(valid_answers) loop
    if inspection_mode = 'ladder' then
      insert into public.inspection_results (inspection_id, inspection_point_id, category_snapshot, question_text_snapshot, display_order_snapshot, result, answer_label, remarks)
      values (inspection_id, (answer->>'point_id')::integer, answer->>'category', answer->>'question', (answer->>'display_order')::integer, answer->>'result', answer->>'answer_label', answer->>'remarks');
    else
      execute format('insert into public.%I (inspection_id, inspection_point_id, question_text_snapshot, display_order_snapshot, result, answer_label, remarks) values ($1,$2,$3,$4,$5,$6,$7)', results_table)
      using inspection_id, (answer->>'point_id')::integer, answer->>'question', (answer->>'display_order')::integer, answer->>'result', answer->>'answer_label', answer->>'remarks';
    end if;
  end loop;
  return jsonb_build_object('id', inspection_id, 'overall_result', overall);
end;
$$;

create or replace function public.submit_inspection(payload jsonb)
returns jsonb language sql security definer set search_path = public as $$ select public.submit_configured_inspection('ladder', payload); $$;
create or replace function public.submit_fire_inspection(payload jsonb)
returns jsonb language sql security definer set search_path = public as $$ select public.submit_configured_inspection('fire', payload); $$;
create or replace function public.submit_firstaid_inspection(payload jsonb)
returns jsonb language sql security definer set search_path = public as $$ select public.submit_configured_inspection('firstaid', payload); $$;

revoke all on function public.submit_configured_inspection(text, jsonb) from public;
revoke all on function public.get_inspection_questionnaire(jsonb) from public;
grant execute on function public.get_inspection_questionnaire(jsonb) to anon, authenticated;
grant execute on function public.submit_inspection(jsonb), public.submit_fire_inspection(jsonb), public.submit_firstaid_inspection(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
