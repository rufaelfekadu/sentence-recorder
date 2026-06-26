export type RatingColumnType = "yes_no" | "text";

export interface RatingColumn {
  key: string;
  label: string;
  type: RatingColumnType;
  required?: boolean;
}

export interface RatingSchema {
  columns: RatingColumn[];
}

export type YesNoValue = "yes" | "no" | null;

export type RatingFieldValue = YesNoValue | string | null;

export interface RatingTaskSummary {
  taskId: string;
  hasSubmissions: boolean;
  assigned: number;
  validAudio: number;
  missing: number;
  empty: number;
  extra: number;
  duplicates: number;
  rated: number;
  pendingRatings: number;
}

export interface RatingSentence {
  sentenceId: string;
  sentence: string;
  hasAudio: boolean;
  audioSize: number;
  audioUrl: string | null;
  fields: Record<string, RatingFieldValue>;
  updatedAt: string | null;
}

export interface RatingTaskDetail {
  taskId: string;
  sentences: RatingSentence[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RatingUpdate {
  sentenceId: string;
  fields: Record<string, RatingFieldValue>;
}

export interface RaterInfo {
  raterId: string;
  displayName?: string | null;
  tasks: string[];
}
