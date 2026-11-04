(function () {
  'use strict';
  const common = { inspector_name: 'inspectorName', epf_number: 'epfNumber', inspection_date: 'inspectionDate' };
  const bindings = {
    ladder: { ...common, ladder_no: 'ladderNo', section: 'ladderSection', height_feet: 'heightFeet', ladder_type: 'ladderType' },
    fire: { ...common, point_no: 'pointNo', location: 'location', quantity: 'quantity', extinguisher_type: 'extinguisherType', pressure_weight: 'pressureWeight' },
    firstaid: { ...common, box_no: 'boxNo', location: 'location' }
  };
  function canonical(mode, key) {
    if (mode === 'fire') return ({ ladder_no: 'point_no', section: 'location', ladder_type: 'extinguisher_type' })[key] || key;
    if (mode === 'firstaid') return ({ ladder_no: 'box_no', section: 'location' })[key] || key;
    return key;
  }
  window.InspectionConfiguration = class {
    constructor(mode) { this.mode = mode; this.fields = new Map(); }
    apply(config) {
      this.fields.clear();
      for (const field of config.fields || []) {
        const key = canonical(this.mode, field.field_key);
        const id = bindings[this.mode][key];
        if (!id) continue;
        this.fields.set(id, field);
        const controls = id === 'ladderType' ? Array.from(document.querySelectorAll('input[name="ladderType"]')) : [document.getElementById(id)].filter(Boolean);
        const wrapper = id === 'ladderType' ? document.querySelector('.type-grid') : controls[0]?.parentElement;
        if (!wrapper) continue;
        wrapper.hidden = !field.is_active;
        wrapper.style.display = field.is_active ? '' : 'none';
        for (const control of controls) {
          control.disabled = !field.is_active;
          control.required = field.is_active && field.is_required;
          if ('placeholder' in control) control.placeholder = field.placeholder || '';
          if (!field.is_active) {
            if (control.type === 'radio') control.checked = false;
            else control.value = '';
          }
          if (control.tagName === 'SELECT' && field.options?.length) {
            const previous = control.value;
            control.replaceChildren(new Option(field.placeholder || 'Select...', ''), ...field.options.map(option => new Option(option.option_label, option.option_value)));
            control.value = previous;
          }
        }
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) {
          label.textContent = field.question;
          if (field.is_active && field.is_required) {
            const mark = document.createElement('span'); mark.className = 'req'; mark.textContent = '*'; label.appendChild(mark);
          }
        }
        const error = document.getElementById('err-' + id);
        if (error) error.textContent = '';
      }
      for (const block of document.querySelectorAll('#inspectionForm > .section-block')) {
        const controls = Array.from(block.querySelectorAll('.form-input, input[name="ladderType"]'));
        if (!controls.length) continue;
        block.hidden = controls.every(control => control.disabled);
        block.style.display = block.hidden ? 'none' : '';
      }
    }
    required(id) {
      const field = this.fields.get(id);
      if (field) return field.is_active && field.is_required;
      if (id === 'ladderType') return true;
      return Boolean(document.getElementById(id)?.required);
    }
    inactive(id) { return this.fields.get(id)?.is_active === false; }
    validationErrors() {
      const errors = [];
      for (const id of Object.values(bindings[this.mode])) {
        const input = id === 'ladderType' ? document.querySelector('input[name="ladderType"]:checked') : document.getElementById(id);
        if (this.inactive(id)) continue;
        const value = input?.value?.trim() || '';
        const label = this.fields.get(id)?.question || document.querySelector(`label[for="${id}"]`)?.textContent.replace('*', '').trim() || 'Ladder Type';
        if (this.required(id) && !value) errors.push({ id, message: label + ' is required.' });
        else if (value && input?.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) errors.push({ id, message: 'Enter a valid positive number.' });
      }
      return errors;
    }
    prepare(payload) {
      for (const [key, id] of Object.entries(bindings[this.mode])) {
        const field = this.fields.get(id);
        if (field && !field.is_active) payload[key] = null;
        else if (id !== 'ladderType') {
          const input = document.getElementById(id);
          if (input && !input.value.trim()) payload[key] = null;
        }
      }
      return payload;
    }
  };
}());
