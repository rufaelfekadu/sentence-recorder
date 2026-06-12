const BOLD_ENABLED = true;
const HAS_BOLD_TAG = /\{b\}.*?\{\/b\}/;

function stripBoldTags(sentence: string): string {
  return sentence.replace(/\{b\}|\{\/b\}/g, "");
}

interface FormattedSentenceProps {
  sentence: string;
}

export default function FormattedSentence({ sentence }: FormattedSentenceProps) {
  const hasErrorWord = HAS_BOLD_TAG.test(sentence);
  const displayText = hasErrorWord ? stripBoldTags(sentence) : sentence;

  if (BOLD_ENABLED && hasErrorWord) {
    return <span className="text-danger">{displayText}</span>;
  }

  return <>{displayText}</>;
}
