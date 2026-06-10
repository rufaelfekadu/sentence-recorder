export type ReviewStatus = "valid" | "invalid" | "pending";

export interface TaskSummary {
  taskId: string;
  hasSubmissions: boolean;
  assigned: number;
  validAudio: number;
  missing: number;
  empty: number;
  extra: number;
  duplicates: number;
  reviewed: number;
  validReviews: number;
  invalidReviews: number;
  pendingReviews: number;
}

export interface ValidationSentence {
  sentenceId: string;
  sentence: string;
  hasAudio: boolean;
  audioSize: number;
  audioUrl: string | null;
  status: ReviewStatus;
  note: string | null;
  updatedAt: string | null;
}

export interface ReviewUpdate {
  sentenceId: string;
  status: ReviewStatus;
  note?: string | null;
}
