-- Seed: Fire Extinguisher Inspection points

insert into fire_checklist_documents (doc_no, title, issued_date, revision, prepared_reviewed_by, approved_by)
values ('SML/HSE/CL/21', 'Fire Extinguisher Inspection Record Sheet', '2026-03-20', '00/00.00.0000',
        'Management Representative', 'Managing Director');

insert into fire_inspection_points (category, question, question_type, display_order) values
  ('fire_extinguisher', 'Safety pin', 'decision', 1),
  ('fire_extinguisher', 'Liver/hose/Nozzles', 'decision', 2),
  ('fire_extinguisher', 'Easily Accessible', 'decision', 3),
  ('fire_extinguisher', 'No Blockages / Barriers', 'decision', 4),
  ('fire_extinguisher', 'Pressure at Optimum Level', 'decision', 5),
  ('fire_extinguisher', 'Seals are not Damaged', 'decision', 6),
  ('fire_extinguisher', 'Other Parts are in Good Condition', 'decision', 7),
  ('fire_extinguisher', 'Not Overdue / Expired', 'decision', 8);

-- Add options for the decision type questions
do $$
declare
  r record;
begin
  for r in select id from fire_inspection_points where question_type = 'decision' loop
    insert into fire_question_options (question_id, option_label, option_value, sort_order, is_fail_value) values
      (r.id, 'PASS', 'PASS', 1, false),
      (r.id, 'FAIL', 'FAIL', 2, true),
      (r.id, 'N/A', 'N/A', 3, false);
  end loop;
end;
$$;
