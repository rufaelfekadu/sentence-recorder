export interface SentenceEntity {
  sentenceId: string;
  sentence: string;
  hasSubmitted?: boolean;
  submittedAudioUrl?: string | null;
}

export interface PendingSelection {
  audioUrl: string;
  isChecked: boolean;
}

export interface TaskDetail {
  taskId: string;
  sentences: SentenceEntity[];
  total: number;
  assignedTotal: number;
  submittedCount: number;
  page: number;
  pageSize: number;
}
