"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Category,
  ChecklistDocument,
  InspectionPoint,
  LadderType,
  Result,
  SubmitResponse,
} from "@/types/database";

const CATEGORY_LABEL: Record<Category, string> = {
  general: "General inspection",
  extension: "Extension ladder",
  step: "Step ladder",
};

const OPTIONS: { value: Result; icon: string; checked: string }[] = [
  { value: "PASS", icon: "✓", checked: "peer-checked:border-green-800 peer-checked:bg-green-800 peer-checked:text-white" },
  { value: "FAIL", icon: "✕", checked: "peer-checked:border-red-800 peer-checked:bg-red-800 peer-checked:text-white" },
  { value: "N/A", icon: "—", checked: "peer-checked:border-stone-600 peer-checked:bg-stone-600 peer-checked:text-white" },
];

const field =
  "mt-1 block h-12 w-full rounded-sm border border-stone-400 bg-white px-3 text-base focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400";

type Answer = { result?: Result; remarks: string };

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

export default function InspectionForm({
  points,
  doc,
}: {
  points: InspectionPoint[];
  doc: ChecklistDocument | null;
}) {
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const [inspector, setInspector] = useState("");
  const [date, setDate] = useState(today);
  const [ladderNo, setLadderNo] = useState("");
  const [section, setSection] = useState("");
  const [feet, setFeet] = useState("");
  const [ladderType, setLadderType] = useState<LadderType | "">("");
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState<SubmitResponse | null>(null);

  // General points + the points for the selected ladder type, grouped in order.
  const groups = useMemo(() => {
    const cats: Category[] = ladderType ? ["general", ladderType] : ["general"];
    return cats.map((c) => ({ category: c, items: points.filter((p) => p.category === c) }));
  }, [points, ladderType]);

  const visible = groups.flatMap((g) => g.items);
  const answered = visible.filter((p) => answers[p.id]?.result).length;

  function setAnswer(id: number, patch: Partial<Answer>) {
    setAnswers((a) => ({ ...a, [id]: { remarks: "", ...a[id], ...patch } }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!inspector.trim()) e.inspector = "Enter the inspector's name.";
    if (!date) e.date = "Choose the inspection date.";
    if (!ladderNo.trim()) e.ladderNo = "Enter the ladder number.";
    if (!section.trim()) e.section = "Enter the section.";
    if (!(Number(feet) > 0)) e.feet = "Enter the ladder height in feet.";
    if (!ladderType) e.type = "Choose the ladder type.";
    for (const p of visible) {
      const a = answers[p.id];
      if (!a?.result) e[`p${p.id}`] = "Choose PASS, FAIL or N/A.";
      else if (a.result === "FAIL" && !a.remarks.trim()) e[`r${p.id}`] = "Describe the problem.";
    }
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    const e = validate();
    setErrors(e);
    setSubmitError("");
    if (Object.keys(e).length) {
      document.getElementById("form-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("submit_inspection", {
      payload: {
        submission_key: submissionKey,
        inspector_name: inspector,
        inspection_date: date,
        ladder_no: ladderNo,
        section,
        height_feet: Number(feet),
        ladder_type: ladderType,
        remarks,
        results: visible.map((p) => ({
          point_id: p.id,
          result: answers[p.id].result,
          remarks: answers[p.id].remarks,
        })),
      },
    });
    setSubmitting(false);
    if (error || !data) {
      console.error("submit_inspection failed:", error);
      setSubmitError("The inspection was not saved. Check your connection and press Save inspection again.");
      return;
    }
    setDone(data as SubmitResponse);
    window.scrollTo({ top: 0 });
  }

  function reset() {
    setSubmissionKey(crypto.randomUUID());
    setInspector("");
    setDate(today());
    setLadderNo("");
    setSection("");
    setFeet("");
    setLadderType("");
    setAnswers({});
    setRemarks("");
    setErrors({});
    setSubmitError("");
    setDone(null);
  }

  const header = (
    <header className="border-b-8 border-amber-400 bg-stone-900 text-white">
      <div className="mx-auto max-w-2xl px-4 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Ladder inspection checklist</h1>
        {doc && (
          <p className="mt-1 text-sm text-stone-300">
            Document {doc.doc_no}
            {doc.revision ? `, revision ${doc.revision}` : ""}
          </p>
        )}
      </div>
    </header>
  );

  if (done) {
    const pass = done.overall_result === "PASS";
    return (
      <div className="min-h-screen bg-stone-100 text-stone-900">
        {header}
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div role="status" className={`border-l-8 bg-white p-6 ${pass ? "border-green-800" : "border-red-800"}`}>
            <p className="text-sm text-stone-600">Inspection saved</p>
            <p className={`mt-1 text-3xl font-bold ${pass ? "text-green-800" : "text-red-800"}`}>
              {pass ? "✓ PASS" : "✕ FAIL"}
            </p>
            <p className="mt-3">
              Ladder {ladderNo.trim()} · reference <span className="font-mono">{done.id.slice(0, 8)}</span>
            </p>
            {!pass && <p className="mt-2">Take this ladder out of service until the failed items are fixed.</p>}
          </div>
          <button
            type="button"
            onClick={reset}
            className="mt-6 h-14 w-full rounded-sm bg-stone-900 text-lg font-semibold text-white focus-visible:ring-4 focus-visible:ring-amber-400"
          >
            Start new inspection
          </button>
        </main>
      </div>
    );
  }

  const errorList = Object.values(errors);

  return (
    <div className="min-h-screen bg-stone-100 pb-28 text-stone-900">
      {header}
      <form onSubmit={onSubmit} noValidate className="mx-auto max-w-2xl space-y-8 px-4 py-6">
        <section aria-labelledby="ladder-h" className="space-y-4 bg-white p-4">
          <h2 id="ladder-h" className="text-lg font-semibold">Ladder details</h2>

          <div>
            <label htmlFor="inspector" className="font-medium">Inspector name</label>
            <input id="inspector" className={field} value={inspector} onChange={(e) => setInspector(e.target.value)} autoComplete="name" />
            {errors.inspector && <p className="mt-1 text-sm font-medium text-red-800">{errors.inspector}</p>}
          </div>

          <div>
            <label htmlFor="date" className="font-medium">Inspection date</label>
            <input id="date" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
            {errors.date && <p className="mt-1 text-sm font-medium text-red-800">{errors.date}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ladderNo" className="font-medium">Ladder no.</label>
              <input id="ladderNo" className={field} value={ladderNo} onChange={(e) => setLadderNo(e.target.value)} />
              {errors.ladderNo && <p className="mt-1 text-sm font-medium text-red-800">{errors.ladderNo}</p>}
            </div>
            <div>
              <label htmlFor="section" className="font-medium">Section</label>
              <input id="section" className={field} value={section} onChange={(e) => setSection(e.target.value)} />
              {errors.section && <p className="mt-1 text-sm font-medium text-red-800">{errors.section}</p>}
            </div>
            <div>
              <label htmlFor="feet" className="font-medium">Height (feet)</label>
              <input id="feet" inputMode="decimal" className={field} value={feet} onChange={(e) => setFeet(e.target.value)} />
              {errors.feet && <p className="mt-1 text-sm font-medium text-red-800">{errors.feet}</p>}
            </div>
          </div>

          <fieldset>
            <legend className="font-medium">Ladder type</legend>
            <div className="mt-1 grid grid-cols-2 gap-3">
              {(["extension", "step"] as LadderType[]).map((t) => (
                <div key={t}>
                  <input
                    type="radio" name="ladderType" id={`type-${t}`} value={t}
                    checked={ladderType === t} onChange={() => setLadderType(t)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={`type-${t}`}
                    className="flex h-14 cursor-pointer items-center justify-center rounded-sm border-2 border-stone-400 bg-white text-base font-semibold peer-checked:border-stone-900 peer-checked:bg-stone-900 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-amber-400"
                  >
                    {CATEGORY_LABEL[t]}
                  </label>
                </div>
              ))}
            </div>
            {errors.type && <p className="mt-1 text-sm font-medium text-red-800">{errors.type}</p>}
          </fieldset>
        </section>

        {groups.map((g) => (
          <section key={g.category} aria-labelledby={`h-${g.category}`}>
            <h2 id={`h-${g.category}`} className="text-lg font-semibold">{CATEGORY_LABEL[g.category]}</h2>
            {g.category === "general" && (
              <p className="mt-1 text-sm text-stone-600">PASS means no defect was found and the requirement is met.</p>
            )}
            <ol className="mt-3 space-y-3">
              {g.items.map((p) => {
                const a = answers[p.id];
                return (
                  <li key={p.id} className="bg-white p-4">
                    <fieldset>
                      <legend className="text-base">{p.question}</legend>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {OPTIONS.map((o) => (
                          <div key={o.value}>
                            <input
                              type="radio" name={`p${p.id}`} id={`p${p.id}-${o.value}`} value={o.value}
                              checked={a?.result === o.value}
                              onChange={() => setAnswer(p.id, { result: o.value })}
                              className="peer sr-only"
                            />
                            <label
                              htmlFor={`p${p.id}-${o.value}`}
                              className={`flex h-14 cursor-pointer items-center justify-center gap-1 rounded-sm border-2 border-stone-400 bg-white font-semibold peer-focus-visible:ring-4 peer-focus-visible:ring-amber-400 ${o.checked}`}
                            >
                              <span aria-hidden="true">{o.icon}</span> {o.value}
                            </label>
                          </div>
                        ))}
                      </div>
                      {errors[`p${p.id}`] && <p className="mt-2 text-sm font-medium text-red-800">{errors[`p${p.id}`]}</p>}
                    </fieldset>
                    {a?.result === "FAIL" && (
                      <div className="mt-3">
                        <label htmlFor={`r${p.id}`} className="font-medium">Reason / remarks</label>
                        <textarea
                          id={`r${p.id}`} rows={3} value={a.remarks}
                          onChange={(e) => setAnswer(p.id, { remarks: e.target.value })}
                          className="mt-1 block w-full rounded-sm border border-stone-400 bg-white p-3 text-base focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                        />
                        {errors[`r${p.id}`] && <p className="mt-1 text-sm font-medium text-red-800">{errors[`r${p.id}`]}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        {!ladderType && (
          <p className="bg-white p-4 text-stone-600">Choose a ladder type to see its extra checklist points.</p>
        )}

        <div className="bg-white p-4">
          <label htmlFor="remarks" className="font-medium">Overall remarks (optional)</label>
          <textarea
            id="remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)}
            className="mt-1 block w-full rounded-sm border border-stone-400 bg-white p-3 text-base focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          />
        </div>

        <div id="form-errors" aria-live="polite">
          {errorList.length > 0 && (
            <p role="alert" className="border-l-4 border-red-800 bg-white p-4 font-medium text-red-800">
              {errorList.length} {errorList.length === 1 ? "item needs" : "items need"} attention before you can save.
            </p>
          )}
          {submitError && (
            <p role="alert" className="mt-3 border-l-4 border-red-800 bg-white p-4 font-medium text-red-800">{submitError}</p>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-stone-300 bg-white">
          <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3">
            <p className="text-sm text-stone-700" aria-live="polite">
              {answered} of {visible.length} answered
            </p>
            <button
              type="submit" disabled={submitting}
              className="ml-auto h-14 min-w-44 rounded-sm bg-amber-400 px-6 text-lg font-bold text-stone-900 focus-visible:ring-4 focus-visible:ring-stone-900 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save inspection"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
