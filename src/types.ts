export interface Ref {
  id: string;
  path: string;
  sha256: string;
  start: number;
  end: number;
  chars: number;
}
export interface SourceBlock extends Ref { text: string }
export interface Judgment extends Ref { probability: number | null }
export interface Selection {
  matches: Judgment[];
  judgments: Judgment[];
  total: number;
  unknown: number;
  belowThreshold: number;
  threshold: number;
  completenessGuaranteed: false;
}

/** A code-owned candidate. Jev never invents these; it only scores them. */
export interface Span {
  id: string;
  path: string;
  start: number;
  end: number;
  label?: string;
  text: string;
  sha256?: string;
  kind?: string;
}
export interface SpanScore {
  id: string;
  path: string;
  start: number;
  end: number;
  label: string | null;
  /** Which view this score belongs to. Probabilities compete only inside one view. */
  view: number;
  probability: number | null;
  sha256?: string;
}
export interface LocateView {
  view: number;
  present: number | null;
  spans: SpanScore[];
}
export interface LocateResult {
  /** One entry per view, in the order submitted. Spans inside a view are ranked; views are not. */
  views: LocateView[];
  spans: SpanScore[];
  /** Highest per-view present. Null only when every view omitted it. Use views[].present to drop a view. */
  present: number | null;
  unknown: number;
  omitted: number;
  completenessGuaranteed: false;
}
export interface AskAnswer {
  type: "noul" | "choice" | "score" | null;
  probability: number | null;
  choice: string | null;
  probabilities: Record<string, number> | null;
  score: number | null;
  confidence: number | null;
}
export interface AskResult {
  answers: Record<string, AskAnswer>;
  /** Question ids whose answers were missing or not a usable number. */
  unknown: string[];
  completenessGuaranteed: false;
}
export interface MapResult {
  /** Original record IDs, never model-generated or normalized. */
  items: Record<string, AskResult & { status: "completed" | "failed" | "not_attempted" }>;
  unknown: Array<{ record: string; question: string }>;
  requests: number;
  errors: Array<{ batch: number; message: string }>;
  completenessGuaranteed: false;
}
export type Trace = (event: Record<string, unknown>) => void;
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return value;
}
export function text(value: unknown, name: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be a nonempty string of at most ${max} characters`);
  return value;
}
