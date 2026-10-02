export type Category = "general" | "extension" | "step";
export type LadderType = "extension" | "step";
export type Result = "PASS" | "FAIL" | "N/A";

export interface InspectionPoint {
  id: number;
  category: Category;
  question: string;
  display_order: number;
}

export interface ChecklistDocument {
  doc_no: string;
  revision: string | null;
}

export interface SubmitResponse {
  id: string;
  overall_result: "PASS" | "FAIL";
}
