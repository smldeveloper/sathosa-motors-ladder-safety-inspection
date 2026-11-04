(function () {
  'use strict';
  const choices = new Set(['decision', 'yes_no', 'multiple_choice']);
  const typeOf = question => question?.question_type || 'decision';
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hasValue = answer => answer?.result !== null && answer?.result !== undefined && String(answer.result).trim() !== '';
  function isFail(question, answer) {
    if (!choices.has(typeOf(question)) || !hasValue(answer)) return false;
    const option = (question.options || []).find(option => option.option_value === String(answer.result));
    return Boolean(option?.is_fail_value || ['FAIL', 'EXPIRED'].includes(String(answer.result)));
  }
  function validationError(question, answer) {
    if (!hasValue(answer)) return question.is_required ? 'An answer is required.' : '';
    const type = typeOf(question);
    const value = String(answer.result);
    if (choices.has(type) && !(question.options || []).some(option => option.option_value === value)) return 'Select a valid answer.';
    if (type === 'number' && !Number.isFinite(Number(value))) return 'Enter a valid number.';
    if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return 'Enter a valid date.';
    return '';
  }
  function isCompatible(question, answer) {
    if ((answer.question_type || 'decision') !== typeOf(question)) return false;
    return !hasValue(answer) || !validationError({ ...question, is_required: false }, answer);
  }
  function updateState(question, answer) {
    const card = document.getElementById('qcard-' + question.id);
    if (!card) return;
    const status = document.getElementById('qstatus-' + question.id);
    const box = document.getElementById('failBox_' + question.id);
    card.classList.remove('is-pass', 'is-fail', 'is-warn', 'needs-answer');
    card.style.removeProperty('border-color');
    const failure = isFail(question, answer);
    if (box) box.style.display = failure ? 'block' : 'none';
    if (!hasValue(answer)) { status.textContent = '○'; return; }
    const expired = failure && String(answer.result) === 'EXPIRED';
    card.classList.add(expired ? 'is-warn' : failure ? 'is-fail' : 'is-pass');
    status.textContent = expired ? '⚠' : failure ? '✕' : '✓';
  }
  function restore(question, answer) {
    const card = document.getElementById('qcard-' + question.id);
    if (!card) return;
    if (choices.has(typeOf(question))) {
      card.querySelectorAll('input[type="radio"]').forEach(input => { input.checked = hasValue(answer) && input.value === String(answer.result); });
    } else {
      const input = document.getElementById('answer_' + question.id);
      if (input) input.value = hasValue(answer) ? String(answer.result) : '';
    }
    const remark = document.getElementById('remark_' + question.id);
    if (remark) remark.value = answer?.remarks || '';
    updateState(question, answer);
  }
  function render(question, container, answers, onChange, onRemark) {
    const type = typeOf(question);
    const isChoice = choices.has(type);
    const firstAid = container.id === 'checklistContainer';
    let control;
    if (isChoice) {
      control = `<div class="decision-row">${(question.options || []).map(option => {
        const failure = option.is_fail_value || ['FAIL', 'EXPIRED'].includes(option.option_value);
        const expired = failure && option.option_value === 'EXPIRED';
        const cls = firstAid ? expired ? 'expired' : failure ? 'missing' : 'present' : failure ? 'fail' : 'pass';
        return `<label class="d-opt ${cls}"><input type="radio" name="ans_${question.id}" value="${esc(option.option_value)}"><div class="d-btn">${expired ? '⚠' : failure ? '✕' : '✓'} ${esc(option.option_label)}</div></label>`;
      }).join('')}</div>`;
    } else if (type === 'long_text') {
      control = `<textarea id="answer_${question.id}" class="form-textarea" rows="3" placeholder="${esc(question.placeholder)}" aria-label="${esc(question.question)}"></textarea>`;
    } else {
      const inputType = type === 'number' || type === 'date' ? type : 'text';
      control = `<input id="answer_${question.id}" class="form-input" type="${inputType}" ${type === 'number' ? 'step="any"' : ''} placeholder="${esc(question.placeholder)}" aria-label="${esc(question.question)}">`;
    }
    const card = document.createElement('div');
    card.className = 'q-card';
    card.id = 'qcard-' + question.id;
    card.dataset.questionType = type;
    card.innerHTML = `<div class="q-meta"><div class="q-status" id="qstatus-${question.id}">○</div><span class="q-num">#${question.display_order || question.id}</span><span class="q-text">${esc(question.question || question.text)}${question.is_required ? ' <span style="color:var(--c-accent)">*</span>' : ''}</span></div>
      ${control}<span class="error-msg" id="err-answer-${question.id}"></span>
      ${isChoice ? `<div class="fail-remarks" id="failBox_${question.id}" style="display:none;"><div class="fail-remarks-label">Describe the issue / reason for failure (required)</div><textarea class="form-textarea" id="remark_${question.id}" rows="2"></textarea><span class="error-msg" id="err-remark-${question.id}"></span></div>` : ''}`;
    container.appendChild(card);
    card.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', () => onChange(question.id, input.value)));
    const input = document.getElementById('answer_' + question.id);
    if (input) { input.required = Boolean(question.is_required); input.addEventListener('input', () => onChange(question.id, input.value)); }
    const remark = document.getElementById('remark_' + question.id);
    if (remark) remark.addEventListener('input', () => onRemark(question.id, remark.value));
    restore(question, answers[question.id]);
  }
  function change(question, answers, value) {
    if (!question) return;
    answers[question.id] = { ...answers[question.id], result: value, remarks: answers[question.id]?.remarks || '', question_type: typeOf(question) };
    const error = document.getElementById('err-answer-' + question.id);
    if (error) error.textContent = '';
    updateState(question, answers[question.id]);
  }
  function serialize(question, answer) {
    const type = typeOf(question);
    return { point_id: question.id, value: type === 'number' ? Number(answer.result) : String(answer.result),
      ...(choices.has(type) ? { result: String(answer.result) } : {}), remarks: answer.remarks || '' };
  }
  window.InspectionAnswers = { render, change, restore, hasValue, isFail, isCompatible, validationError, serialize };
}());
