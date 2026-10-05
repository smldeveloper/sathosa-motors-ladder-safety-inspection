const fs = require('fs');
let serverCode = fs.readFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\server.js', 'utf8');

// 1. Add epf_number to SELECT in /api/inspections
serverCode = serverCode.replace(
  'i.inspector_name, i.overall_result',
  'i.inspector_name, i.epf_number, i.overall_result'
);

// 2. Add reordering to POST /api/questions
serverCode = serverCode.replace(
  /app\.post\('\/api\/questions', requireAdmin, async \(req, res, next\) => \{([\s\S]*?)await client\.query\('begin'\);/,
  `app.post('/api/questions', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (q.display_order) {
      await client.query('update inspection_points set display_order = display_order + 1 where display_order >= $1', [q.display_order]);
    }`
);

// 3. Add reordering to PUT /api/questions/:id
serverCode = serverCode.replace(
  /app\.put\('\/api\/questions\/:id', requireAdmin, async \(req, res, next\) => \{([\s\S]*?)await client\.query\('begin'\);/,
  `app.put('/api/questions/:id', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: curr } = await client.query('select display_order from inspection_points where id = $1', [req.params.id]);
    const currOrder = curr[0]?.display_order;
    if (q.display_order && currOrder && q.display_order !== currOrder) {
      if (q.display_order < currOrder) {
        await client.query('update inspection_points set display_order = display_order + 1 where display_order >= $1 and display_order < $2', [q.display_order, currOrder]);
      } else {
        await client.query('update inspection_points set display_order = display_order - 1 where display_order <= $1 and display_order > $2', [q.display_order, currOrder]);
      }
    }`
);

fs.writeFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\server.js', serverCode);

let adminHtml = fs.readFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\index.html', 'utf8');
adminHtml = adminHtml.replace('<th>Inspector</th>', '<th>Inspector / EPF</th>');
fs.writeFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\index.html', adminHtml);

let adminJs = fs.readFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\admin.js', 'utf8');

// Render EPF Number in table row
adminJs = adminJs.replace(
  '<td>${esc(r.inspector_name)}</td>',
  '<td>${esc(r.inspector_name)}<br><span style="font-size:0.78rem;color:var(--text-2);">EPF: ${esc(r.epf_number)}</span></td>'
);

// Remove N/A option from renderOptionsEditor
adminJs = adminJs.replace(
  /renderOptionsEditor\(\[\s*\{\s*option_label:\s*'PASS'[\s\S]*?\}\s*\]\);/,
  `renderOptionsEditor([
    { option_label: 'PASS', option_value: 'PASS', is_fail_value: false },
    { option_label: 'FAIL', option_value: 'FAIL', is_fail_value: true },
  ]);`
);

// Also remove N/A option when questionType changes
adminJs = adminJs.replace(
  /addOptionRow\(\{ option_label: 'N\/A'[\s\S]*?\}\);/,
  ``
);

fs.writeFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\admin.js', adminJs);

console.log('Admin panel successfully updated.');
