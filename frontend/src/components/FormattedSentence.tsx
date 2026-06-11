import React from "react";

const BOLD_ENABLED = false;
const BOLD_TAG = /\{b\}(.*?)\{\/b\}/g;

interface FormattedSentenceProps {
  sentence: string;
}

export default function FormattedSentence({ sentence }: FormattedSentenceProps) {
  if (!BOLD_TAG.test(sentence)) {
    return <>{sentence}</>;
  }

  BOLD_TAG.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BOLD_TAG.exec(sentence)) !== null) {
    if (match.index > lastIndex) {
      parts.push(sentence.slice(lastIndex, match.index));
    }
    parts.push(
      BOLD_ENABLED ? (
        <strong key={match.index} className="fw-bold">
          {match[1]}
        </strong>
      ) : (
        match[1]
      ),
    );
    lastIndex = BOLD_TAG.lastIndex;
  }

  if (lastIndex < sentence.length) {
    parts.push(sentence.slice(lastIndex));
  }

  return <>{parts}</>;
}
