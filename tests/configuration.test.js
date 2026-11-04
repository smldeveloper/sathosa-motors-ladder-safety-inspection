import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const shared = readFileSync(new URL('../public/questionnaire-config.js', import.meta.url), 'utf8');
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
