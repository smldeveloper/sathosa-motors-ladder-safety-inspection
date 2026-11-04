import { deleteQuestion } from './lib/delete-question.cjs';
import { buildInspectionWorkbook } from './lib/inspection-export.cjs';
import 'dotenv/config';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import pg from 'pg';
import XLSX from 'xlsx';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const sessions = new Set();

function getTables(req) {
  const mode = req.query.mode === 'fire' ? 'fire' : req.query.mode === 'firstaid' ? 'firstaid' : 'ladder';
  if (mode === 'fire') {
    return {
      points: 'fire_inspection_points',
      options: 'fire_question_options',
      inspections: 'fire_inspections',
      results: 'fire_inspection_results'
    };
  }
  if (mode === 'firstaid') {
    return {
      points: 'firstaid_inspection_points',
      options: 'firstaid_question_options',
      inspections: 'firstaid_inspections',
      results: 'firstaid_inspection_results'
    };
  }
  return {
    points: 'inspection_points',
    options: 'question_options',
    inspections: 'inspections',
    results: 'inspection_results'
  };
}


const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (sessions.has(req.cookies.admin_session)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function normalizeQuestion(row, index) {
  const text = String(row.Question || row.question || row.question_text || '').trim();
  const section = String(row.Section || row.section || row.Category || row.category || 'general').trim().toLowerCase();
  const questionType = String(row['Question Type'] || row.question_type || row.Type || 'decision').trim().toLowerCase();
  const requiredRaw = row.Required ?? row.required ?? true;
  const activeRaw = row.Active ?? row.active ?? true;
  const sortRaw = row['Question Number'] ?? row.sort_order ?? row.display_order ?? index + 1;
  const optionsRaw = String(row.Options || row.options || '').trim();
  const options = optionsRaw
    ? optionsRaw.split('|').map((part, optionIndex) => {
        const [labelValue, flag] = part.split(':');
        const [label, value] = labelValue.includes('=')
          ? labelValue.split('=')
          : [labelValue, labelValue];
        return {
          option_label: String(label || '').trim(),
          option_value: String(value || label || '').trim(),
          sort_order: optionIndex + 1,
          is_fail_value: String(flag || '').trim().toLowerCase() === 'fail',
        };
      })
    : [];

  return {
    category: section,
    question: text,
    question_type: questionType,
    display_order: Number(sortRaw),
    is_required: ['true', 'yes', '1', 'required'].includes(String(requiredRaw).trim().toLowerCase()),
    is_active: !['false', 'no', '0', 'inactive'].includes(String(activeRaw).trim().toLowerCase()),
    options,
  };
}

function validateQuestions(questions) {
  const errors = [];
  const seen = new Set();
  const validTypes = new Set(['decision', 'yes_no', 'multiple_choice', 'text', 'long_text', 'number', 'date']);
  const validSections = new Set(['general', 'extension', 'step']);

  questions.forEach((q, index) => {
    const row = index + 2;
    if (!q.question) errors.push(`Row ${row}: missing question text.`);
    if (!validSections.has(q.category)) errors.push(`Row ${row}: invalid section "${q.category}". Use general, extension, or step.`);
    if (!validTypes.has(q.question_type)) errors.push(`Row ${row}: invalid question type "${q.question_type}".`);
    if (!Number.isFinite(q.display_order) || q.display_order <= 0) errors.push(`Row ${row}: invalid question number/order.`);
    const key = `${q.category}|${q.question.toLowerCase()}`;
    if (seen.has(key)) errors.push(`Row ${row}: duplicate question in the same section.`);
    seen.add(key);
    const needsOptions = ['decision', 'yes_no', 'multiple_choice'].includes(q.question_type);
    if (needsOptions && !q.options.length) errors.push(`Row ${row}: selectable question requires options.`);
    q.options.forEach((option, optionIndex) => {
      if (!option.option_label || !option.option_value) errors.push(`Row ${row}: option ${optionIndex + 1} is missing a label or value.`);
    });
  });

  return errors;
}

async function getQuestions(mode = 'ladder') {
  const tables = getTables({ query: { mode } });
  const isLadder = mode !== 'fire' && mode !== 'firstaid';
  const query = isLadder
    ? `select id, category, question, display_order, is_required, is_active, created_at, updated_at from ${tables.points} where not is_deleted order by display_order, id`
    : `select id, '${mode}' as category, question, display_order, is_required, is_active, created_at, updated_at from ${tables.points} where not is_deleted order by display_order, id`;

  const { rows: questions } = await pool.query(query);
  const { rows: options } = await pool.query(`
    select id, question_id, option_label, option_value, sort_order, is_fail_value, is_active
    from ${tables.options}
    order by sort_order, id
  `);
  const grouped = new Map();
  for (const option of options) {
    if (!grouped.has(option.question_id)) grouped.set(option.question_id, []);
    grouped.get(option.question_id).push(option);
  }
  return questions.map(q => ({
    ...q,
    question_type: 'decision',
    allow_remarks: true,
    options: grouped.get(q.id) || []
  }));
}

async function replaceOptions(client, questionId, options = [], mode = 'ladder') {
  const tables = getTables({query: {mode}});
  await client.query(`delete from ${tables.options} where question_id = $1`, [questionId]);
  for (const [index, option] of options.entries()) {
    await client.query(
      `insert into ${tables.options} (question_id, option_label, option_value, sort_order, is_fail_value, is_active)
       values ($1, $2, $3, $4, $5, true)`,
      [questionId, option.option_label, option.option_value, option.sort_order || index + 1, !!option.is_fail_value],
    );
  }
}

app.post('/api/login', (req, res) => {
  const expected = process.env.ADMIN_PASSWORD || '';
  const supplied = String(req.body?.password || '');
  if (!expected || supplied !== expected) return res.status(401).json({ error: 'Invalid password' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/logout', requireAdmin, (req, res) => {
  sessions.delete(req.cookies.admin_session);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: sessions.has(req.cookies.admin_session) });
});

app.get('/api/questions', requireAdmin, async (req, res, next) => {
  try {
    res.json(await getQuestions(req.query.mode));
  } catch (error) {
    next(error);
  }
});

app.post('/api/questions', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  const isLadder = req.query.mode !== 'fire' && req.query.mode !== 'firstaid';
  try {
    await client.query('begin');
    const { rows } = isLadder
      ? await client.query(
          `insert into ${getTables(req).points} (category, question, display_order, is_required, is_active)
           values ($1, $2, $3, $4, $5)
           returning id`,
          [q.category || 'general', q.question, q.display_order, !!q.is_required, q.is_active !== false],
        )
      : await client.query(
          `insert into ${getTables(req).points} (question, display_order, is_required, is_active)
           values ($1, $2, $3, $4)
           returning id`,
          [q.question, q.display_order, !!q.is_required, q.is_active !== false],
        );
    await replaceOptions(client, rows[0].id, q.options || [], req.query.mode);
    await client.query('commit');
    res.json({ id: rows[0].id });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.put('/api/questions/:id', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  const isLadder = req.query.mode !== 'fire' && req.query.mode !== 'firstaid';
  try {
    await client.query('begin');
    const { rows: existing } = await client.query(`select id from ${getTables(req).points} where id=$1 and not is_deleted for update`, [req.params.id]);
    if (!existing.length) throw Object.assign(new Error('Question not found.'), { status: 404 });
    if (isLadder) {
      await client.query(
        `update ${getTables(req).points}
            set category=$1, question=$2, display_order=$3,
                is_required=$4, is_active=$5, updated_at=now()
          where id=$6 and not is_deleted`,
        [q.category || 'general', q.question, q.display_order, !!q.is_required, q.is_active !== false, req.params.id],
      );
    } else {
      await client.query(
        `update ${getTables(req).points}
            set question=$1, display_order=$2,
                is_required=$3, is_active=$4, updated_at=now()
          where id=$5 and not is_deleted`,
        [q.question, q.display_order, !!q.is_required, q.is_active !== false, req.params.id],
      );
    }
    await replaceOptions(client, req.params.id, q.options || [], req.query.mode);
    await client.query('commit');
    res.json({ ok: true });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.delete('/api/questions/:id', requireAdmin, async (req, res, next) => {
  try {
    if (req.query.mode !== undefined && !['ladder', 'fire', 'firstaid'].includes(req.query.mode)) return res.status(400).json({ error: 'Invalid inspection mode.' });
    res.json(await deleteQuestion(pool, getTables(req), req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/inspections', requireAdmin, async (req, res, next) => {
  try {
    const t = getTables(req);
    const mode = req.query.mode || 'ladder';
    const isFire = mode === 'fire';
    const isFirstAid = mode === 'firstaid';

    const ladderNoCol = isFire ? 'point_no' : isFirstAid ? 'box_no' : 'ladder_no';
    const sectionCol = isFire ? 'location' : isFirstAid ? 'location' : 'section';
    const heightExpr = isFire ? 'i.quantity::text' : isFirstAid ? "''" : 'i.height_feet::text';
    const typeExpr = isFire ? 'i.extinguisher_type' : isFirstAid ? "''" : 'i.ladder_type';
    const pressureExpr = isFire ? 'i.pressure_weight' : 'null';

    const filters = [];
    const values = [];
    if (req.query.from) { values.push(req.query.from); filters.push(`i.inspection_date >= $${values.length}`); }
    if (req.query.to) { values.push(req.query.to); filters.push(`i.inspection_date <= $${values.length}`); }
    if (req.query.ladder) { values.push(`%${req.query.ladder}%`); filters.push(`i.${ladderNoCol} ilike $${values.length}`); }
    if (req.query.inspector) { values.push(`%${req.query.inspector}%`); filters.push(`i.inspector_name ilike $${values.length}`); }
    if (req.query.status) { values.push(req.query.status); filters.push(`i.overall_result = $${values.length}`); }
    const where = filters.length ? `where ${filters.join(' and ')}` : '';
    const { rows } = await pool.query(`
      select i.id, i.inspection_date, i.${ladderNoCol} as ladder_no, i.${sectionCol} as section,
             ${heightExpr} as height_feet, ${typeExpr} as ladder_type,
             ${pressureExpr} as pressure_weight,
             i.inspector_name, i.overall_result, i.remarks, i.created_at,
             count(r.id)::int as answer_count,
             count(*) filter (where r.result = 'FAIL' or r.result = 'EXPIRED')::int as fail_count
        from ${t.inspections} i
        left join ${t.results} r on r.inspection_id = i.id
        ${where}
       group by i.id
       order by i.inspection_date desc, i.created_at desc
       limit 500
    `, values);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/inspections/:id', requireAdmin, async (req, res, next) => {
  try {
    const t = getTables(req);
    const mode = req.query.mode || 'ladder';
    const catExpr = mode === 'ladder' ? 'r.category_snapshot' : `'${mode}'`;
    const { rows } = await pool.query(`
      select r.display_order_snapshot as order,
             ${catExpr} as category,
             r.question_text_snapshot as question,
             r.result, coalesce(r.answer_label, r.result) as answer_label, r.remarks
        from ${t.results} r
       where r.inspection_id = $1
       order by r.display_order_snapshot asc
    `, [req.params.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/questionnaire', requireAdmin, async (req, res, next) => {
  try {
    const questions = await getQuestions(req.query.mode);
    const rows = questions.map(q => ({
      'Question Number': q.display_order,
      Section: q.category,
      Question: q.question,
      'Question Type': q.question_type,
      Required: q.is_required ? 'yes' : 'no',
      Active: q.is_active ? 'yes' : 'no',
      Options: q.options.map(o => `${o.option_label}=${o.option_value}${o.is_fail_value ? ':fail' : ''}`).join('|'),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Questionnaire');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="questionnaire.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

function inspectionFilters(req) {
  const mode = req.query.mode || 'ladder';
  getTables(req);
  const equipment = mode === 'fire' ? 'point_no' : mode === 'firstaid' ? 'box_no' : 'ladder_no';
  const location = mode === 'ladder' ? 'section' : 'location';
  const filters = [];
  const values = [];
  for (const name of ['from', 'to']) {
    if (!req.query[name]) continue;
    const date = req.query[name];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw Object.assign(new Error('Invalid date filter.'), { status: 400 });
    }
    values.push(date);
    filters.push(`i.inspection_date ${name === 'from' ? '>=' : '<='} $${values.length}`);
  }
  if (req.query.from && req.query.to && req.query.from > req.query.to) throw Object.assign(new Error('From date must be before or equal to To date.'), { status: 400 });
  if (req.query.ladder) {
    values.push(`%${req.query.ladder}%`);
    filters.push(`(i.${equipment} ilike $${values.length} or i.${location} ilike $${values.length})`);
  }
  if (req.query.inspector) { values.push(`%${req.query.inspector}%`); filters.push(`i.inspector_name ilike $${values.length}`); }
  if (req.query.status) {
    if (!['PASS', 'FAIL', 'EXPIRED'].includes(req.query.status)) throw Object.assign(new Error('Invalid result filter.'), { status: 400 });
    values.push(req.query.status); filters.push(`i.overall_result = $${values.length}`);
  }
  return { where: filters.length ? `where ${filters.join(' and ')}` : '', values };
}

app.get('/api/export/inspections', requireAdmin, async (req, res, next) => {
  try {
    const mode = req.query.mode || 'ladder';
    if (!['ladder', 'fire', 'firstaid'].includes(mode)) return res.status(400).json({ error: 'Invalid inspection mode.' });
    const tables = getTables(req);
    const { where, values } = inspectionFilters(req);
    const { rows: questions } = await pool.query(`
      select id, category, question, display_order, is_active, is_deleted, field_key, updated_at
      from ${tables.points} order by display_order, id
    `);
    const category = mode === 'ladder' ? 'r.category_snapshot' : `'${mode}'`;
    const { rows } = await pool.query(`
      select i.*, i.id as inspection_id, i.remarks as overall_remarks,
             r.inspection_point_id as question_id,
             r.display_order_snapshot as question_number, ${category} as category,
             r.question_text_snapshot as question, r.result as answer,
             coalesce(r.answer_label, r.result) as answer_label, r.remarks as answer_remarks
      from ${tables.inspections} i
      left join ${tables.results} r on r.inspection_id = i.id
      ${where}
      order by i.inspection_date, i.created_at, i.id, r.display_order_snapshot, r.id
    `, values);
    const workbook = await buildInspectionWorkbook({ mode, questions, rows, templatePath: path.join(__dirname, 'fire_extinguisher_template.xlsx') });
    const filenames = { ladder: 'LADDER-CHECKLIST-EXPORT.xlsx', fire: 'FIRE-EXTINGUISHER-CHECKLIST-EXPORT.xlsx', firstaid: 'FIRST-AID-CHECKLIST-EXPORT.xlsx' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenames[mode]}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await workbook.xlsx.writeBuffer());
  } catch (error) {
    next(error);
  }
});


app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Server error' });
});

const port = Number(process.env.PORT || 8081);
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Safety Inspection Admin running on http://localhost:${port}`);
  });
}

export default app;
