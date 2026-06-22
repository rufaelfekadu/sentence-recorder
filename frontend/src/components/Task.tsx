import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import TaskDescription from "./TaskDescription";
import RecordTable from "./RecordTable";
import { SentenceEntity } from "./types";
import config from "../config.json";

const fetchSentences = async (taskId: string): Promise<SentenceEntity[]> => {
  const response = await fetch(`${config.backendUrl}/read-json/${taskId}`);
  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }
  return response.json();
};

const Task = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [sentences, setSentences] = useState<SentenceEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [selectedRecordings, setSelectedRecordings] = useState<
    { sentenceId: string; audioUrl: string }[]
  >([]);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadSentences = useCallback(async () => {
    if (!taskId) return;
    try {
      const data = await fetchSentences(taskId);
      setSentences(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? "Unknown error");
    }
  }, [taskId]);

  useEffect(() => {
    loadSentences();
  }, [loadSentences]);

  const submittedCount =
    sentences?.filter((s) => s.hasSubmitted).length ?? 0;
  const totalCount = sentences?.length ?? 0;
  const allSubmitted = totalCount > 0 && submittedCount === totalCount;

  const handleSubmit = async () => {
    if (!agreed) {
      alert("Please agree to the terms before submitting.");
      return;
    }

    if (selectedRecordings.length === 0) {
      alert("Please select at least one recording before submitting.");
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    const formattedData = await Promise.all(
      selectedRecordings.map(async (data) => {
        const response = await fetch(data.audioUrl);
        const blob = await response.blob();
        const reader = new FileReader();

        const base64String = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        return {
          sentenceId: data.sentenceId,
          audioUrl: base64String,
        };
      }),
    );

    try {
      const response = await fetch(
        `${config.backendUrl}/submit-recordings/${taskId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formattedData),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to submit: ${response.statusText}`);
      }

      const count = selectedRecordings.length;
      setSelectedRecordings([]);
      await loadSentences();
      setSubmitMessage(
        `${count} recording${count === 1 ? "" : "s"} uploaded successfully.`,
      );
    } catch (err) {
      console.error("Error during submission:", err);
      alert("Failed to submit recordings.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!sentences) {
    return <div>Loading...</div>;
  }

  return (
    <div className="Task">
      <Container className="my-5 text-center">
        <TaskDescription setAgreed={setAgreed} />

        {submitMessage && (
          <Alert variant="success" className="fs-5">
            {submitMessage}
          </Alert>
        )}

        {allSubmitted && (
          <Alert variant="success" className="fs-5">
            All recordings have been submitted. Thank you for participating!
            <div className="mt-3">
              <Link to="/finished">
                <Button variant="success" className="fs-5">
                  Go to completion page
                </Button>
              </Link>
            </div>
          </Alert>
        )}

        <RecordTable
          sentences={sentences}
          submittedCount={submittedCount}
          totalCount={totalCount}
          onSelectionUpdate={setSelectedRecordings}
        />
        <Button
          type="submit"
          variant="outline-primary"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="fs-4 fw-bold my-4"
        >
          {isSubmitting ? "Submitting..." : "Submit All Checked Recordings"}
        </Button>
      </Container>
    </div>
  );
};

export default Task;
