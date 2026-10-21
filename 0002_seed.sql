-- Seed: taken verbatim from LADDER-_CHECKLIST.xlsx (24 points: 15 general, 5 extension, 4 step)

insert into inspection_points (category, question, display_order) values
  ('general',   'Ladder number available', 1),
  ('general',   'All the rungs, cleats, or steps are in good condition (Broken, missing, bend rungs)', 2),
  ('general',   'Side rails is intact without any cracks, bends, or breaks.', 3),
  ('general',   'The rungs, cleats, or steps is fit into the side rails without damage.', 4),
  ('general',   'Ladder is free from corrosion.', 5),
  ('general',   'Side rails and steps are free from oil or grease.', 6),
  ('general',   'Rungs are placed at regular intervals (30 cm gap between two rungs)', 7),
  ('general',   'Projection of loose nails, screws, bolts, or other metal parts', 8),
  ('general',   'At the time of using, the ladder should be placed at 65-75 degree angle (1(Horizontal):4 (Vertical) ratio).', 9),
  ('general',   'Ladder is extended at least 1m above the landing platform (3 Rungs). If ladder is in wall then somebody should hold at bottom.', 10),
  ('general',   'Ladder is secured either at top or at the bottom', 11),
  ('general',   'Ladder rungs should not be painted.', 12),
  ('general',   'Reinforcement rod should not be used as ladder rungs', 13),
  ('general',   'The surface of the rungs should not be smooth', 14),
  ('general',   'Rubber feet for firm grip (in case of Aluminum ladder)', 15),
  ('extension', 'Loose, missing or broken extension locks', 16),
  ('extension', 'Defective locks which do not seat properly when ladder is extended. Pulley, Rope, lock, and sliding arrangement must be in proper working condition.', 17),
  ('extension', 'Loose hinges', 18),
  ('extension', 'Three arms over lap is required.', 19),
  ('extension', 'Ensure stopper without damage', 20),
  ('step',      'Step ladder height should not to exceed by 20 feet.', 21),
  ('step',      'Loose hinges', 22),
  ('step',      'Loose or bent hinge spreaders', 23),
  ('step',      'Ensure Spreader without damage and locking Mechanism', 24);

-- Add options (PASS / FAIL / N/A) for all ladder inspection points
insert into question_options (question_id, option_label, option_value, sort_order, is_fail_value)
select
  p.id,
  o.label,
  o.val,
  o.sort_order,
  o.is_fail
from inspection_points p
cross join (
  values
    ('PASS', 'PASS', 1, false),
    ('FAIL', 'FAIL', 2, true),
    ('N/A',  'N/A',  3, false)
) as o(label, val, sort_order, is_fail)
order by p.display_order, o.sort_order;
