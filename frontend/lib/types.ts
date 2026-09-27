export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}
export interface CurriculumAssignment {
  id: string;
  status:
    "assigned" | "in_progress" | "not_performed" | "interrupted" | "completed";
  assignedAt: string;
  completedAt: string | null;
  curriculum: { id: string; name: string };
}
export interface UserProfile extends User {
  isOnboarded: boolean;
  currency: { balance: number };
  currentCurriculum: CurriculumAssignment | null;
}
export interface AuthResponse {
  user: User;
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}
export interface Definition {
  code: string;
  label: string;
  category: string;
  factor: string;
  unit: string;
  valueType: "integer" | "decimal";
  minAge: number;
  maxAge: number;
  minValue: string | null;
  maxValue: string | null;
  minInclusive: boolean;
  sourceUrls: string[];
}
export interface Catalog {
  version: string;
  checkedOn: string;
  age: number | null;
  definitions: Definition[];
}
export interface MeasurementItemInput {
  measurementCode: string;
  value: string;
  unit: string;
  reportedGrade: string | null;
}
/** Runtime-validated separately so malformed evaluations never hide raw values. */
export interface MeasurementItem extends MeasurementItemInput {
  evaluation?: unknown;
}
export interface MeasurementMetadata {
  measuredOn: string;
  ageAtMeasurement: number;
  sexAtMeasurement: "male" | "female" | null;
  reportKind: "standard" | "simple" | "unknown";
  centerName: string | null;
  reportedOverallGrade: string | null;
}
export interface MeasurementSummary extends MeasurementMetadata {
  id: string;
  catalogVersion: string;
  revision: number;
  itemCount: number;
  sourceProgram: string;
  entryMethod: string;
  createdAt: string;
  updatedAt: string;
}
export interface Measurement extends Omit<MeasurementSummary, "itemCount"> {
  items: MeasurementItem[];
  missingMeasurementCodes: string[];
  /** Validated at the evaluation adapter boundary; raw records remain readable. */
  evaluation: unknown;
  axes?: unknown;
}
export interface MeasurementPage {
  items: MeasurementSummary[];
  nextCursor: string | null;
}
export interface MeasurementInput extends MeasurementMetadata {
  entryMethod?: "manual" | "self_assessment";
  catalogVersion: string;
  items: MeasurementItemInput[];
}
export interface RecordResponse {
  data: Measurement;
  etag: string;
}
