export interface SentenceEntity {
  sentenceId: string;
  sentence: string;
  hasSubmitted?: boolean;
  submittedAudioUrl?: string | null;
}
