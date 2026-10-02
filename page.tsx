import InspectionForm from "@/components/InspectionForm";
import { supabase } from "@/lib/supabase";
import type { ChecklistDocument, InspectionPoint } from "@/types/database";

export const revalidate = 0; // always load the latest checklist

export default async function Page() {
  const [pointsRes, docRes] = await Promise.all([
    supabase
      .from("inspection_points")
      .select("id, category, question, display_order")
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("checklist_documents")
      .select("doc_no, revision")
      .eq("is_current", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (pointsRes.error || !pointsRes.data?.length) {
    console.error("Failed to load checklist:", pointsRes.error);
    return (
      <main className="min-h-screen bg-stone-100 p-6 text-stone-900">
        <div className="mx-auto max-w-xl border-l-4 border-red-700 bg-white p-5">
          <h1 className="text-lg font-semibold">The checklist could not be loaded</h1>
          <p className="mt-2">Check your connection and reload the page. If it keeps happening, tell your supervisor.</p>
        </div>
      </main>
    );
  }

  return (
    <InspectionForm
      points={pointsRes.data as InspectionPoint[]}
      doc={(docRes.data as ChecklistDocument | null) ?? null}
    />
  );
}
