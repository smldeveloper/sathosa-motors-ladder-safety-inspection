const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgres://postgres.jqamraigolylhtpvrjgm:GWqW3%252VEzR3%40vJ@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Add epf_number to inspections if it does not exist
    const { rows: cols } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspections' AND column_name = 'epf_number';");
    if (cols.length === 0) {
      await client.query('ALTER TABLE inspections ADD COLUMN epf_number text not null default \'00000\';');
      await client.query('ALTER TABLE inspections ALTER COLUMN epf_number DROP DEFAULT;');
      await client.query('ALTER TABLE inspections ADD CONSTRAINT inspections_epf_number_check CHECK (length(btrim(epf_number)) > 0);');
    }

    // 2. Update submit_inspection function
    await client.query(`
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
              where x.point_id = p.id and x.result in ('PASS', 'FAIL'));
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

        select id into v_doc from checklist_documents where is_current order by id desc limit 1;

        insert into inspections (checklist_document_id, inspector_name, epf_number, inspection_date,
                                 ladder_no, section, height_feet, ladder_type,
                                 overall_result, remarks, submission_key)
        values (v_doc,
                btrim(payload->>'inspector_name'),
                btrim(payload->>'epf_number'),
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
           and x.result in ('PASS', 'FAIL');

        return jsonb_build_object('id', v_id, 'overall_result', v_overall);
      end;
      $$;
    `);

    // Clean up N/A options from question_options if any exist
    await client.query('DELETE FROM question_options WHERE option_value = \'N/A\';');
    
    await client.query('COMMIT');
    console.log('Database migration completed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    pool.end();
  }
}
migrate().catch(console.error);
