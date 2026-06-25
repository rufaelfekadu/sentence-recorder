import React, { useEffect, useState, useRef } from "react";
import Table from "react-bootstrap/Table";
import Form from "react-bootstrap/Form";
import Badge from "react-bootstrap/Badge";
import IconButton from "@mui/material/IconButton";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import { useReactMediaRecorder } from "../utils/ReactMediaRecorder";
import FormattedSentence from "./FormattedSentence";
import UnsubmittedFilter from "./UnsubmittedFilter";
import { PendingSelection, SentenceEntity } from "./types";
import config from "../config.json";
import "./RecordTable.css";

const StartStopButton: React.FC<{
  status: string;
  startRecording: () => void;
  stopRecording: () => void;
  isRecordingElsewhere: boolean;
  setIsRecordingElsewhere: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({
  status,
  startRecording,
  stopRecording,
  isRecordingElsewhere,
  setIsRecordingElsewhere,
}) => {
  useEffect(() => {
    if (status === "recording") setIsRecordingElsewhere(true);
    if (status === "stopped") setIsRecordingElsewhere(false);
  }, [status, setIsRecordingElsewhere]);

  return (
    <IconButton
      onClick={status === "recording" ? stopRecording : startRecording}
      disabled={isRecordingElsewhere && status !== "recording"}
    >
      {isRecordingElsewhere && status !== "recording" ? (
        <MicIcon color="disabled" className="micstop" />
      ) : status === "recording" ? (
        <StopIcon color="error" className="micstop" />
      ) : (
        <MicIcon color="primary" className="micstop" />
      )}
    </IconButton>
  );
};

const RecordCheckbox: React.FC<{
  isChecked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}> = ({ isChecked, onChange, label }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <Form>
      <Form.Check
        type="checkbox"
        label={label}
        checked={isChecked}
        onChange={handleChange}
      />
    </Form>
  );
};

const RecordTableRow: React.FC<{
  sentenceEntity: SentenceEntity;
  initialSelection?: PendingSelection;
  isRecordingElsewhere: boolean;
  setIsRecordingElsewhere: React.Dispatch<React.SetStateAction<boolean>>;
  onSelectionChange: (
    id: string,
    audioUrl: string | null,
    isChecked: boolean,
  ) => void;
}> = ({
  sentenceEntity,
  initialSelection,
  isRecordingElsewhere,
  setIsRecordingElsewhere,
  onSelectionChange,
}) => {
  const { status, startRecording, stopRecording, mediaBlobUrl } =
    useReactMediaRecorder({ audio: true });
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(
    initialSelection?.audioUrl ?? null,
  );
  const [serverAudioUrl, setServerAudioUrl] = useState<string | null>(null);
  const [isChecked, setIsChecked] = useState(initialSelection?.isChecked ?? false);
  const prevHasSubmitted = useRef(!!sentenceEntity.hasSubmitted);

  useEffect(() => {
    if (!sentenceEntity.hasSubmitted || !sentenceEntity.submittedAudioUrl) {
      setServerAudioUrl(null);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;

    const loadAudio = async () => {
      try {
        const response = await fetch(
          `${config.backendUrl}${sentenceEntity.submittedAudioUrl}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load audio (${response.status})`);
        }
        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);
        if (active) {
          setServerAudioUrl(createdUrl);
        }
      } catch {
        if (active) {
          setServerAudioUrl(null);
        }
      }
    };

    loadAudio();

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [sentenceEntity.hasSubmitted, sentenceEntity.submittedAudioUrl]);

  useEffect(() => {
    if (mediaBlobUrl) {
      setLocalAudioUrl(mediaBlobUrl);
      setIsChecked(true);
      onSelectionChange(sentenceEntity.sentenceId, mediaBlobUrl, true);
    }
  }, [mediaBlobUrl, onSelectionChange, sentenceEntity.sentenceId]);

  useEffect(() => {
    const wasSubmitted = prevHasSubmitted.current;
    const isSubmitted = !!sentenceEntity.hasSubmitted;
    if (!wasSubmitted && isSubmitted) {
      setLocalAudioUrl(null);
      setIsChecked(false);
      onSelectionChange(sentenceEntity.sentenceId, null, false);
    }
    prevHasSubmitted.current = isSubmitted;
  }, [sentenceEntity.hasSubmitted, onSelectionChange, sentenceEntity.sentenceId]);

  const playbackUrl = localAudioUrl ?? serverAudioUrl;

  return (
    <tr className="fs-4">
      <td>
        <FormattedSentence sentence={sentenceEntity.sentence} />
      </td>
      <td>
        {sentenceEntity.hasSubmitted ? (
          <Badge bg="success">Submitted</Badge>
        ) : null}
      </td>
      <td>
        <StartStopButton
          status={status}
          startRecording={startRecording}
          stopRecording={stopRecording}
          isRecordingElsewhere={isRecordingElsewhere}
          setIsRecordingElsewhere={setIsRecordingElsewhere}
        />
      </td>
      <td>
        <audio src={playbackUrl || "#"} controls />
      </td>
      <td>
        <RecordCheckbox
          isChecked={isChecked}
          label="Submit"
          onChange={(checked) => {
            setIsChecked(checked);
            onSelectionChange(
              sentenceEntity.sentenceId,
              localAudioUrl,
              checked,
            );
          }}
        />
      </td>
    </tr>
  );
};

const RecordTableHeader: React.FC = () => (
  <thead>
    <tr className="fw-bold fs-5">
      <td>Phrases to record</td>
      <td>Status</td>
      <td>Record / Stop</td>
      <td>Check the audio</td>
      <td>Submit the audio</td>
    </tr>
  </thead>
);

const RecordTableBody: React.FC<{
  sentences: SentenceEntity[];
  pendingSelections: Map<string, PendingSelection>;
  onSelectionChange: (
    id: string,
    audioUrl: string | null,
    isChecked: boolean,
  ) => void;
  onRecordingActiveChange: (isActive: boolean) => void;
}> = ({
  sentences,
  pendingSelections,
  onSelectionChange,
  onRecordingActiveChange,
}) => {
  const [isRecordingElsewhere, setIsRecordingElsewhere] =
    useState<boolean>(false);

  useEffect(() => {
    onRecordingActiveChange(isRecordingElsewhere);
  }, [isRecordingElsewhere, onRecordingActiveChange]);

  return (
    <tbody>
      {sentences.map((sentenceEntity) => (
        <RecordTableRow
          key={sentenceEntity.sentenceId}
          sentenceEntity={sentenceEntity}
          initialSelection={pendingSelections.get(sentenceEntity.sentenceId)}
          isRecordingElsewhere={isRecordingElsewhere}
          setIsRecordingElsewhere={setIsRecordingElsewhere}
          onSelectionChange={onSelectionChange}
        />
      ))}
    </tbody>
  );
};

const RecordTable: React.FC<{
  sentences: SentenceEntity[];
  submittedCount: number;
  totalCount: number;
  pendingSelections: Map<string, PendingSelection>;
  onSelectionChange: (
    id: string,
    audioUrl: string | null,
    isChecked: boolean,
  ) => void;
  onRecordingActiveChange: (isActive: boolean) => void;
  unsubmittedOnly: boolean;
  onUnsubmittedOnlyChange: (checked: boolean) => void;
  filterDisabled?: boolean;
}> = ({
  sentences,
  submittedCount,
  totalCount,
  pendingSelections,
  onSelectionChange,
  onRecordingActiveChange,
  unsubmittedOnly,
  onUnsubmittedOnlyChange,
  filterDisabled = false,
}) => {
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="fs-5 fw-bold mb-0">
          {submittedCount} / {totalCount} submitted
        </p>
        <UnsubmittedFilter
          checked={unsubmittedOnly}
          onChange={onUnsubmittedOnlyChange}
          disabled={filterDisabled}
        />
      </div>
      {unsubmittedOnly && sentences.length === 0 ? (
        <p className="text-muted fs-5">
          All recordings submitted — nothing left to record.
        </p>
      ) : (
        <Table hover>
          <RecordTableHeader />
          <RecordTableBody
            sentences={sentences}
            pendingSelections={pendingSelections}
            onSelectionChange={onSelectionChange}
            onRecordingActiveChange={onRecordingActiveChange}
          />
        </Table>
      )}
    </>
  );
};

export default RecordTable;
