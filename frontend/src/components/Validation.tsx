import React, { useCallback, useEffect, useState } from "react";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import {
  authFetch,
  AuthError,
  clearValidationToken,
  getValidationToken,
  setValidationToken,
} from "../utils/authFetch";
import {
  ReviewStatus,
  ReviewUpdate,
  TaskSummary,
  ValidationSentence,
} from "./validationTypes";

const AuthAudio: React.FC<{ audioUrl: string }> = ({ audioUrl }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    const loadAudio = async () => {
      try {
        const response = await authFetch(audioUrl);
        if (!response.ok) {
          throw new Error(`Failed to load audio (${response.status})`);
        }
        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);
        if (active) {
          setObjectUrl(createdUrl);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load audio.");
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
  }, [audioUrl]);

  if (error) {
    return <span className="text-danger">{error}</span>;
  }

  if (!objectUrl) {
    return <span>Loading audio...</span>;
  }

  return <audio src={objectUrl} controls />;
};

const statusVariant = (status: ReviewStatus) => {
  if (status === "valid") return "success";
  if (status === "invalid") return "danger";
  return "secondary";
};

const Validation = () => {
  const [token, setToken] = useState<string | null>(() => getValidationToken());
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<ValidationSentence[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    clearValidationToken();
    setToken(null);
    setSelectedTaskId(null);
    setTasks([]);
    setSentences([]);
    setAuthError("Invalid validation token. Please try again.");
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const response = await authFetch("/validation/tasks");
      if (!response.ok) {
        throw new Error(`Failed to load tasks (${response.status})`);
      }
      const data = await response.json();
      setTasks(data.tasks ?? []);
    } catch (err) {
      if (err instanceof AuthError) {
        handleUnauthorized();
      } else {
        setPageError(err instanceof Error ? err.message : "Failed to load tasks.");
      }
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized]);

  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      setLoading(true);
      setPageError(null);
      setSaveMessage(null);
      try {
        const response = await authFetch(`/validation/tasks/${taskId}`);
        if (!response.ok) {
          throw new Error(`Failed to load task (${response.status})`);
        }
        const data = await response.json();
        setSelectedTaskId(taskId);
        setSentences(data.sentences ?? []);
      } catch (err) {
        if (err instanceof AuthError) {
          handleUnauthorized();
        } else {
          setPageError(err instanceof Error ? err.message : "Failed to load task.");
        }
      } finally {
        setLoading(false);
      }
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    if (token) {
      loadTasks();
    }
  }, [token, loadTasks]);

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setLoading(true);

    try {
      const response = await authFetch("/validation/tasks", {}, tokenInput.trim());
      if (!response.ok) {
        throw new AuthError("Invalid validation token.", response.status);
      }
      setValidationToken(tokenInput.trim());
      setToken(tokenInput.trim());
      setTokenInput("");
      const data = await response.json();
      setTasks(data.tasks ?? []);
    } catch (err) {
      if (err instanceof AuthError) {
        setAuthError("Invalid validation token.");
      } else {
        setAuthError("Unable to verify token.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLock = () => {
    clearValidationToken();
    setToken(null);
    setSelectedTaskId(null);
    setTasks([]);
    setSentences([]);
    setSaveMessage(null);
    setPageError(null);
  };

  const updateSentenceStatus = (sentenceId: string, status: ReviewStatus) => {
    setSentences((prev) =>
      prev.map((sentence) =>
        sentence.sentenceId === sentenceId ? { ...sentence, status } : sentence,
      ),
    );
    setSaveMessage(null);
  };

  const handleSaveReviews = async () => {
    if (!selectedTaskId) return;

    const updates: ReviewUpdate[] = sentences.map((sentence) => ({
      sentenceId: sentence.sentenceId,
      status: sentence.status,
      note: sentence.note,
    }));

    setLoading(true);
    setPageError(null);
    try {
      const response = await authFetch(`/validation/review/${selectedTaskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        throw new Error(`Failed to save reviews (${response.status})`);
      }
      setSaveMessage("Reviews saved.");
      await loadTasks();
      await loadTaskDetail(selectedTaskId);
    } catch (err) {
      if (err instanceof AuthError) {
        handleUnauthorized();
      } else {
        setPageError(err instanceof Error ? err.message : "Failed to save reviews.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Container className="my-5" style={{ maxWidth: "480px" }}>
        <h1 className="mb-4 text-center">Validation Access</h1>
        <p className="text-muted text-center">
          Enter the validation token to review submitted recordings.
        </p>
        <Form onSubmit={handleUnlock}>
          <Form.Group className="mb-3">
            <Form.Label>Validation token</Form.Label>
            <Form.Control
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Enter token"
              required
            />
          </Form.Group>
          {authError && <Alert variant="danger">{authError}</Alert>}
          <Button type="submit" variant="primary" disabled={loading} className="w-100">
            {loading ? "Verifying..." : "Unlock"}
          </Button>
        </Form>
      </Container>
    );
  }

  return (
    <Container className="my-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>Validation</h1>
        <Button variant="outline-secondary" onClick={handleLock}>
          Lock
        </Button>
      </div>

      {pageError && <Alert variant="danger">{pageError}</Alert>}
      {saveMessage && <Alert variant="success">{saveMessage}</Alert>}

      {!selectedTaskId ? (
        <>
          <h2 className="h4 mb-3">Submitted tasks</h2>
          {loading && tasks.length === 0 ? (
            <p>Loading tasks...</p>
          ) : tasks.length === 0 ? (
            <p>No tasks found.</p>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assigned</th>
                  <th>Valid audio</th>
                  <th>Missing</th>
                  <th>Reviewed</th>
                  <th>Pending</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.taskId}>
                    <td>{task.taskId}</td>
                    <td>{task.assigned}</td>
                    <td>{task.validAudio}</td>
                    <td>{task.missing + task.empty}</td>
                    <td>{task.reviewed}</td>
                    <td>{task.pendingReviews}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => loadTaskDetail(task.taskId)}
                        disabled={!task.hasSubmissions}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <Button
                variant="link"
                className="p-0 me-3"
                onClick={() => {
                  setSelectedTaskId(null);
                  setSentences([]);
                  setSaveMessage(null);
                }}
              >
                Back to tasks
              </Button>
              <span className="h4 mb-0">Task: {selectedTaskId}</span>
            </div>
            <Button variant="primary" onClick={handleSaveReviews} disabled={loading}>
              Save reviews
            </Button>
          </div>

          <Table hover responsive>
            <thead>
              <tr>
                <th>Sentence</th>
                <th>Audio</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => (
                <tr key={sentence.sentenceId}>
                  <td>{sentence.sentence}</td>
                  <td>
                    {sentence.hasAudio && sentence.audioUrl ? (
                      <AuthAudio audioUrl={sentence.audioUrl} />
                    ) : (
                      <span className="text-muted">No audio</span>
                    )}
                  </td>
                  <td>
                    <Badge bg={statusVariant(sentence.status)}>{sentence.status}</Badge>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant={
                        sentence.status === "valid" ? "success" : "outline-success"
                      }
                      className="me-2"
                      onClick={() => updateSentenceStatus(sentence.sentenceId, "valid")}
                    >
                      Valid
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        sentence.status === "invalid" ? "danger" : "outline-danger"
                      }
                      onClick={() =>
                        updateSentenceStatus(sentence.sentenceId, "invalid")
                      }
                    >
                      Invalid
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Container>
  );
};

export default Validation;
