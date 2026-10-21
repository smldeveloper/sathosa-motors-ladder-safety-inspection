-- First Aid Box Checklist: seed data (SML/HSE/CL/06)
-- 18 items — 17 required, 1 optional (Clinical Thermometer)

insert into firstaid_inspection_points (question, display_order, is_required)
values
  ('Zinc Oxide Plaster',                              1,  true),
  ('Alcohol Swabs (Pads)',                            2,  true),
  ('Sterile Medical Dressing',                        3,  true),
  ('Sterile Cotton Wool',                             4,  true),
  ('Eye Pad - Cotton Absorbent',                      5,  true),
  ('Eye Pad - Sterile Adhesive Absorbent',            6,  true),
  ('Disposable Examination Gloves - Nitrile',         7,  true),
  ('70% Isopropyl Alcohol',                           8,  true),
  ('Antiseptic Ointment',                             9,  true),
  ('Burn Gel / Burn Dressing',                        10, true),
  ('Sterile Normal Saline / Eye-Wash Solution',       11, true),
  ('Eye Wash Cup',                                    12, true),
  ('Eye Lotion',                                      13, true),
  ('First Aid Scissors',                              14, true),
  ('Medical Adhesive Tape',                           15, true),
  ('Saline',                                          16, true),
  ('Bandage',                                         17, true),
  ('Clinical Thermometer',                            18, false);  -- optional

-- Insert 3 options per item using a clean lateral join (no fragile ORDER BY on UNION ALL)
insert into firstaid_question_options (question_id, option_label, option_value, sort_order, is_fail_value)
select p.id, o.option_label, o.option_value, o.sort_order, o.is_fail_value
from firstaid_inspection_points p
cross join (values
  ('Present', 'PASS',    1, false),
  ('Missing', 'FAIL',    2, true),
  ('Expired', 'EXPIRED', 3, true)
) as o(option_label, option_value, sort_order, is_fail_value)
order by p.display_order, o.sort_order;
