-- Seed: Fire Extinguisher Inspection points (Cleaned & Optimized)

insert into fire_inspection_points (question, display_order) values
  ('Safety pin', 1),
  ('Liver/hose/Nozzles', 2),
  ('Easily Accessible', 3),
  ('No Blockages / Barriers', 4),
  ('Pressure at Optimum Level', 5),
  ('Seals are not Damaged', 6),
  ('Other Parts are in Good Condition', 7),
  ('Not Overdue / Expired', 8);

-- Add options for all points (PASS / FAIL / N/A)
insert into fire_question_options (question_id, option_label, option_value, sort_order, is_fail_value)
select
  p.id,
  o.label,
  o.val,
  o.sort_order,
  o.is_fail
from fire_inspection_points p
cross join (
  values
    ('PASS', 'PASS', 1, false),
    ('FAIL', 'FAIL', 2, true),
    ('N/A',  'N/A',  3, false)
) as o(label, val, sort_order, is_fail)
order by p.display_order, o.sort_order;
