-- Migration: Database Optimization & Bloat Removal
-- Dropping redundant checklist_documents tables, unused columns, and adding check constraints

-- 1. LADDER SCHEMA CLEANUP
ALTER TABLE IF EXISTS inspections DROP CONSTRAINT IF EXISTS inspections_checklist_document_id_fkey CASCADE;
ALTER TABLE IF EXISTS inspections DROP COLUMN IF EXISTS checklist_document_id CASCADE;
DROP TABLE IF EXISTS checklist_reference_images CASCADE;
DROP TABLE IF EXISTS checklist_documents CASCADE;
ALTER TABLE IF EXISTS inspection_points DROP COLUMN IF EXISTS question_type CASCADE;
ALTER TABLE IF EXISTS inspection_points DROP COLUMN IF EXISTS allow_remarks CASCADE;
ALTER TABLE IF EXISTS inspection_results DROP COLUMN IF EXISTS question_type_snapshot CASCADE;

CREATE OR REPLACE FUNCTION submit_inspection(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key     uuid := (payload->>'submission_key')::uuid;
  v_type    text := payload->>'ladder_type';
  v_id      uuid;
  v_overall text;
  v_missing int;
BEGIN
  SELECT id, overall_result INTO v_id, v_overall
    FROM inspections WHERE submission_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
  END IF;

  IF v_type NOT IN ('extension', 'step') THEN
    RAISE EXCEPTION 'Invalid ladder type';
  END IF;

  SELECT count(*) INTO v_missing
    FROM inspection_points p
   WHERE p.is_active AND p.is_required AND p.category IN ('general', v_type)
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text)
        WHERE x.point_id = p.id AND x.result IN ('PASS', 'FAIL', 'N/A'));
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'All checklist points must be answered';
  END IF;

  SELECT CASE WHEN EXISTS (
           SELECT 1
             FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text)
             JOIN inspection_points p ON p.id = x.point_id
            WHERE x.result = 'FAIL' AND p.is_required)
         THEN 'FAIL' ELSE 'PASS' END
    INTO v_overall;

  INSERT INTO inspections (inspector_name, epf_number, inspection_date,
                           ladder_no, section, height_feet, ladder_type,
                           overall_result, remarks, submission_key)
  VALUES (
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
  ON CONFLICT (submission_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id, overall_result INTO v_id, v_overall
      FROM inspections WHERE submission_key = v_key;
    RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
  END IF;

  INSERT INTO inspection_results (inspection_id, inspection_point_id, category_snapshot,
                                  question_text_snapshot, display_order_snapshot,
                                  result, remarks)
  SELECT v_id, p.id, p.category, p.question, p.display_order,
         x.result, nullif(btrim(coalesce(x.remarks, '')), '')
    FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text, remarks text)
    JOIN inspection_points p ON p.id = x.point_id
   WHERE p.is_active AND p.category IN ('general', v_type)
     AND x.result IN ('PASS', 'FAIL', 'N/A');

  RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
END;
$$;

REVOKE ALL ON FUNCTION submit_inspection(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION submit_inspection(jsonb) TO anon, authenticated;

-- 2. FIRE EXTINGUISHER SCHEMA CLEANUP
ALTER TABLE IF EXISTS fire_inspections DROP CONSTRAINT IF EXISTS fire_inspections_checklist_document_id_fkey CASCADE;
ALTER TABLE IF EXISTS fire_inspections DROP COLUMN IF EXISTS checklist_document_id CASCADE;
DROP TABLE IF EXISTS fire_checklist_documents CASCADE;
ALTER TABLE IF EXISTS fire_inspection_points DROP COLUMN IF EXISTS category CASCADE;
ALTER TABLE IF EXISTS fire_inspection_points DROP COLUMN IF EXISTS question_type CASCADE;
ALTER TABLE IF EXISTS fire_inspection_points DROP COLUMN IF EXISTS allow_remarks CASCADE;
ALTER TABLE IF EXISTS fire_inspection_results DROP COLUMN IF EXISTS category_snapshot CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fire_results_result_check') THEN
    ALTER TABLE fire_inspection_results ADD CONSTRAINT fire_results_result_check CHECK (result IN ('PASS', 'FAIL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fire_results_fail_remarks_check') THEN
    ALTER TABLE fire_inspection_results ADD CONSTRAINT fire_results_fail_remarks_check CHECK (result = 'PASS' OR length(btrim(coalesce(remarks, ''))) > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION submit_fire_inspection(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key     uuid := (payload->>'submission_key')::uuid;
  v_id      uuid;
  v_overall text;
  v_missing int;
BEGIN
  SELECT id, overall_result INTO v_id, v_overall
    FROM fire_inspections WHERE submission_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
  END IF;

  SELECT count(*) INTO v_missing
    FROM fire_inspection_points p
   WHERE p.is_active AND p.is_required
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text)
        WHERE x.point_id = p.id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'All checklist points must be answered';
  END IF;

  SELECT CASE WHEN EXISTS (
           SELECT 1
             FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text)
             JOIN fire_question_options o ON o.question_id = x.point_id AND o.option_value = x.result
             JOIN fire_inspection_points p ON p.id = x.point_id
            WHERE o.is_fail_value = true AND p.is_required)
         THEN 'FAIL' ELSE 'PASS' END
    INTO v_overall;

  INSERT INTO fire_inspections (inspector_name, epf_number, inspection_date,
                                point_no, location, quantity, extinguisher_type, pressure_weight,
                                overall_result, remarks, submission_key)
  VALUES (
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
  ON CONFLICT (submission_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id, overall_result INTO v_id, v_overall
      FROM fire_inspections WHERE submission_key = v_key;
    RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
  END IF;

  INSERT INTO fire_inspection_results (inspection_id, inspection_point_id,
                                       question_text_snapshot, display_order_snapshot,
                                       result, answer_label, remarks)
  SELECT v_id, p.id, p.question, p.display_order,
         x.result, o.option_label, nullif(btrim(coalesce(x.remarks, '')), '')
    FROM jsonb_to_recordset(payload->'results') AS x(point_id int, result text, remarks text)
    JOIN fire_inspection_points p ON p.id = x.point_id
    LEFT JOIN fire_question_options o ON o.question_id = p.id AND o.option_value = x.result
   WHERE p.is_active;

  RETURN jsonb_build_object('id', v_id, 'overall_result', v_overall);
END;
$$;

REVOKE ALL ON FUNCTION submit_fire_inspection(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION submit_fire_inspection(jsonb) TO anon, authenticated;
