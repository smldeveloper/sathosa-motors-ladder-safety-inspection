const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgres://postgres.jqamraigolylhtpvrjgm:GWqW3%252VEzR3%40vJ@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function info() {
  const { rows } = await pool.query("SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'inspection_results'::regclass;");
  console.log('Constraints:', rows);
  pool.end();
}
info().catch(console.error);
