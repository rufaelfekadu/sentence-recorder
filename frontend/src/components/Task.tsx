import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Pagination from "react-bootstrap/Pagination";
import TaskDescription from "./TaskDescription";
import RecordTable from "./RecordTable";
import { PendingSelection, SentenceEntity, TaskDetail } from "./types";
import { getVisiblePages, PAGE_SIZE } from "../utils/pagination";
import config from "../config.json";

const fetchTaskPage = async (
  taskId: string,
  page: number,
): Promise<TaskDetail> => {
  const response = await fetch(
    `${config.backendUrl}/read-json/${taskId}?page=${page}&page_size=${PAGE_SIZE}`,
  );
  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }
  return response.json();
};

const Task = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [sentences, setSentences] = useState<SentenceEntity[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pendingSelections, setPendingSelections] = useState<
    Map<string, PendingSelection>
  >(() => new Map());
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSubmitted = total > 0 && submittedCount === total;

  const loadSentences = useCallback(
    async (pageNumber = 1) => {
      if (!taskId) return;

      setLoading(true);
      try {
        const data = await fetchTaskPage(taskId, pageNumber);
        setSentences(data.sentences ?? []);
        setPage(data.page ?? pageNumber);
        setTotal(data.total ?? 0);
        setSubmittedCount(data.submittedCount ?? 0);
        setError(null);
      } catch (err) {
        setError((err as Error).message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    setPage(1);
    setPendingSelections(new Map());
    loadSentences(1);
  }, [loadSentences]);

  const handleSelectionChange = useCallback(
    (id: string, audioUrl: string | null, isChecked: boolean) => {
      setPendingSelections((prev) => {
        const next = new Map(prev);
        if (!audioUrl) {
          next.delete(id);
          return next;
        }
        next.set(id, { audioUrl, isChecked });
        return next;
      });
    },
    [],
  );

  const handlePageChange = (newPage: number) => {
    if (!taskId || newPage < 1 || newPage > totalPages || newPage === page) {
      return;
    }
    loadSentences(newPage);
  };

  const handleSubmit = async () => {
    if (!agreed) {
      alert("Please agree to the terms before submitting.");
      return;
    }

    const checkedEntries = [...pendingSelections.entries()].filter(
      ([, selection]) => selection.isChecked,
    );

    if (checkedEntries.length === 0) {
      alert("Please select at least one recording before submitting.");
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    const formattedData = await Promise.all(
      checkedEntries.map(async ([sentenceId, selection]) => {
        const response = await fetch(selection.audioUrl);
        const blob = await response.blob();
        const reader = new FileReader();

        const base64String = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        return {
          sentenceId,
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

      const count = checkedEntries.length;
      setPendingSelections(new Map());
      await loadSentences(page);
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

  const paginationDisabled = loading || isSubmitting || isRecordingActive;
  const checkedCount = [...pendingSelections.values()].filter(
    (selection) => selection.isChecked,
  ).length;

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
          totalCount={total}
          pendingSelections={pendingSelections}
          onSelectionChange={handleSelectionChange}
          onRecordingActiveChange={setIsRecordingActive}
        />

        {totalPages > 1 && (
          <div className="d-flex justify-content-between align-items-center mt-3">
            <span className="text-muted">
              Page {page} of {totalPages} ({total} sentences)
            </span>
            <Pagination className="mb-0">
              <Pagination.Prev
                disabled={page <= 1 || paginationDisabled}
                onClick={() => handlePageChange(page - 1)}
              />
              {getVisiblePages(page, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <Pagination.Ellipsis key={`ellipsis-${index}`} disabled />
                ) : (
                  <Pagination.Item
                    key={item}
                    active={item === page}
                    disabled={paginationDisabled}
                    onClick={() => handlePageChange(item)}
                  >
                    {item}
                  </Pagination.Item>
                ),
              )}
              <Pagination.Next
                disabled={page >= totalPages || paginationDisabled}
                onClick={() => handlePageChange(page + 1)}
              />
            </Pagination>
          </div>
        )}

        <Button
          type="submit"
          variant="outline-primary"
          onClick={handleSubmit}
          disabled={isSubmitting || checkedCount === 0}
          className="fs-4 fw-bold my-4"
        >
          {isSubmitting
            ? "Submitting..."
            : `Submit All Checked Recordings${checkedCount > 0 ? ` (${checkedCount})` : ""}`}
        </Button>
      </Container>
    </div>
  );
};

export default Task;
