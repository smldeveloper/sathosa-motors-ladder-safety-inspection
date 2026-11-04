import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const shared = readFileSync(new URL('../public/questionnaire-config.js', import.meta.url), 'utf8');
const answersScript = readFileSync(new URL('../public/questionnaire-answers.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function field(id, key, active = true, required = true) {
  return { id, category: 'section_1', field_key: key, question: key, placeholder: 'Configured hint', is_active: active, is_required: required, options: [] };
}
for (const mode of ['ladder', 'fire', 'firstaid']) {
  test(`${mode}: fields hide, reactivate, respect required settings, and refresh without losing answers`, async t => {
    const html = readFileSync(new URL(`../public/${mode}.html`, import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: `http://localhost/${mode}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    const document = window.document;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    let config = { fields: [field(1, 'inspector_name', false), field(2, 'epf_number', true, false), field(3, 'inspection_date')], questions: [
      { id: 20, category: mode === 'ladder' ? 'general' : mode, question: 'Checklist test', is_active: true, is_required: true,
        options: [{ option_label: 'Good', option_value: 'PASS', is_fail_value: false }, { option_label: 'Bad', option_value: 'FAIL', is_fail_value: true }] }
    ] };
    if (mode === 'fire') config.fields.push(field(4, 'quantity', false));
    const calls = [];
    window.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, text: async () => JSON.stringify(structuredClone(config)) };
    };
    new Script(shared).runInContext(dom.getInternalVMContext());
    new Script(answersScript).runInContext(dom.getInternalVMContext());
    const script = Array.from(document.scripts).find(script => script.textContent.includes('const SUPABASE_URL'));
    new Script(script.textContent).runInContext(dom.getInternalVMContext());
    await tick();
    assert.equal(document.getElementById('inspectorName').disabled, true);
    assert.equal(document.getElementById('inspectorName').parentElement.hidden, true);
    if (mode === 'fire') assert.equal(document.getElementById('quantity').parentElement.hidden, true);
    assert.ok(document.getElementById('qcard-20'));
    document.querySelector('input[name="ans_20"][value="PASS"]').checked = true;
    window.onAnswerChange(20, 'PASS');
    config.fields[0] = field(1, 'inspector_name', true, false);
    await window.loadQuestionnaire();
    assert.equal(document.getElementById('inspectorName').disabled, false);
    assert.equal(document.getElementById('inspectorName').parentElement.hidden, false);
    assert.equal(document.getElementById('inspectorName').required, false);
    assert.equal(document.getElementById('inspectorName').placeholder, 'Configured hint');
    assert.equal(document.querySelector('input[name="ans_20"][value="PASS"]').checked, true);
    assert.notEqual(window.validate().firstErrEl?.id, 'inspectorName');
    config.fields[0].is_required = true;
    await window.loadQuestionnaire();
    window.validate();
    assert.match(document.getElementById('err-inspectorName').textContent, /required/);
    config.questions = [];
    config.fields[0].is_active = false;
    window.dispatchEvent(new window.Event('focus'));
    await tick();
    assert.equal(document.getElementById('qcard-20'), null);
    assert.equal(document.getElementById('inspectorName').disabled, true);
    assert.equal(document.getElementById('inspectorName').required, false);
    assert.ok(calls.every(call => call.url.endsWith('/rpc/get_inspection_questionnaire')));
    assert.ok(calls.every(call => call.options.cache === 'no-store'));
  });
}

test('disabled metadata is omitted from payload values and validation', () => {
  const dom = new JSDOM('<input id="inspectorName" required><input id="quantity" required><input id="pointNo"><input id="inspectionDate">', { runScripts: 'outside-only' });
  const { window } = dom;
  new Script(shared).runInContext(dom.getInternalVMContext());
  const configuration = new window.InspectionConfiguration('fire');
  configuration.apply({ fields: [field(1, 'inspector_name', false), field(2, 'quantity', false)] });
  const payload = configuration.prepare({ inspector_name: 'Stale value', quantity: 'Stale value' });
  assert.equal(payload.inspector_name, null);
  assert.equal(payload.quantity, null);
  assert.equal(configuration.validationErrors().length, 0);
  dom.window.close();
});

for (const mode of ['ladder', 'fire', 'firstaid']) {
  test(`${mode}: all question types render, retain input during refresh, validate, and submit actual values`, async t => {
    const html = readFileSync(new URL(`../public/${mode}.html`, import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: `http://localhost/${mode}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    const doc = window.document;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    const types = ['text', 'long_text', 'number', 'date', 'decision', 'yes_no', 'multiple_choice'];
    const config = { fields: [], questions: types.map((type, i) => ({ id: 17 + i, category: mode === 'ladder' ? 'general' : mode,
      question: 'Question ' + type, question_type: type, is_active: true, is_required: true, placeholder: 'Enter ' + type,
      options: ['decision', 'yes_no', 'multiple_choice'].includes(type) ? [
        { option_label: type === 'yes_no' ? 'Yes' : type === 'multiple_choice' ? 'Safe' : 'PASS', option_value: type === 'yes_no' ? 'YES' : type === 'multiple_choice' ? 'SAFE' : 'PASS', is_fail_value: false },
        { option_label: 'Needs action', option_value: 'FAIL', is_fail_value: true }
      ] : []
    })) };
    let submitted;
    window.fetch = async (url, options) => {
      if (!url.endsWith('get_inspection_questionnaire')) {
        submitted = JSON.parse(options.body).payload;
        return { ok: true, text: async () => JSON.stringify({ id: 'saved', overall_result: 'PASS' }) };
      }
      return { ok: true, text: async () => JSON.stringify(config) };
    };
    const context = dom.getInternalVMContext();
    new Script(shared).runInContext(context);
    new Script(answersScript).runInContext(context);
    new Script(Array.from(doc.scripts).find(script => script.textContent.includes('const SUPABASE_URL')).textContent).runInContext(context);
    await tick();
    for (const [id, type] of [[17, 'text'], [19, 'number'], [20, 'date']]) assert.equal(doc.getElementById('answer_' + id).type, type);
    assert.equal(doc.getElementById('answer_18').tagName, 'TEXTAREA');
    assert.equal(doc.querySelectorAll('#qcard-17 input[type="radio"]').length, 0);
    assert.equal(doc.getElementById('answer_17').placeholder, 'Enter text');
    window.validate();
    assert.match(doc.getElementById('err-answer-17').textContent, /required/);
    for (const [id, value] of [[17, 'FAIL'], [18, 'First line\nSecond line'], [19, '0'], [20, '2026-11-04']]) {
      const input = doc.getElementById('answer_' + id);
      input.value = value;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    for (const id of [21, 22, 23]) {
      const input = doc.querySelector(`input[name="ans_${id}"]`);
      input.checked = true;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    assert.equal(doc.getElementById('qcard-17').classList.contains('is-fail'), false, 'text FAIL is not a failed safety decision');
    config.questions[0].placeholder = 'Updated hint';
    await window.loadQuestionnaire();
    assert.equal(doc.getElementById('answer_17').value, 'FAIL');
    assert.equal(doc.getElementById('answer_18').value, 'First line\nSecond line');
    assert.equal(doc.getElementById('answer_19').value, '0');
    assert.equal(doc.getElementById('answer_20').value, '2026-11-04');
    const metadata = { inspectorName: 'Tester', epfNumber: '0012', inspectionDate: '2026-11-04', ladderNo: 'L-1', ladderSection: 'Bay', heightFeet: '12', pointNo: 'FE-1', location: 'Bay', quantity: '1', extinguisherType: 'CO2', pressureWeight: '5 kg', boxNo: 'FA-1' };
    for (const [id, value] of Object.entries(metadata)) if (doc.getElementById(id)) doc.getElementById(id).value = value;
    if (mode === 'ladder') {
      const type = doc.getElementById('type-extension');
      type.checked = true;
      type.dispatchEvent(new window.Event('change'));
    }
    doc.getElementById('inspectionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await tick();
    assert.ok(submitted, doc.getElementById('errorModalText').textContent);
    assert.equal(submitted.results.find(answer => answer.point_id === 17).value, 'FAIL');
    assert.equal(submitted.results.find(answer => answer.point_id === 18).value, 'First line\nSecond line');
    assert.equal(submitted.results.find(answer => answer.point_id === 19).value, 0);
    assert.equal(submitted.results.find(answer => answer.point_id === 20).value, '2026-11-04');
    assert.equal(submitted.results.length, 7);
    config.questions[0].question_type = 'decision';
    config.questions[0].options = config.questions[4].options;
    await window.loadQuestionnaire();
    assert.equal(doc.getElementById('answer_17'), null);
    assert.equal(doc.querySelectorAll('input[name="ans_17"]:checked').length, 0, 'changing types must clear the incompatible old answer');
  });
}
