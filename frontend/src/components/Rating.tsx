import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Pagination from "react-bootstrap/Pagination";
import {
  clearRaterToken,
  fetchRatingSchema,
  getRaterToken,
  raterAuthFetch,
  RaterAuthError,
  setRaterToken,
} from "../utils/raterAuthFetch";
import FormattedSentence from "./FormattedSentence";
import RatingCell from "./RatingCell";
import {
  RatingColumn,
  RatingFieldValue,
  RatingSchema,
  RatingSentence,
  RatingTaskDetail,
  RatingTaskSummary,
  RatingUpdate,
  RaterInfo,
} from "./ratingTypes";
import { getVisiblePages, PAGE_SIZE } from "../utils/pagination";

const RaterAudio: React.FC<{ raterId: string; audioUrl: string }> = ({
  raterId,
  audioUrl,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    const loadAudio = async () => {
      try {
        const response = await raterAuthFetch(raterId, audioUrl);
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
  }, [raterId, audioUrl]);

  if (error) {
    return <span className="text-danger">{error}</span>;
  }

  if (!objectUrl) {
    return <span>Loading audio...</span>;
  }

  return <audio src={objectUrl} controls />;
};

const mergeRatingChanges = (
  loadedSentences: RatingSentence[],
  changes: Map<string, RatingUpdate>,
): RatingSentence[] =>
  loadedSentences.map((sentence) => {
    const change = changes.get(sentence.sentenceId);
    if (!change) return sentence;
    return {
      ...sentence,
      fields: { ...sentence.fields, ...change.fields },
    };
  });

const Rating = () => {
  const { raterId, taskId: urlTaskId } = useParams<{
    raterId: string;
    taskId?: string;
  }>();

  const [token, setToken] = useState<string | null>(() =>
    raterId ? getRaterToken(raterId) : null,
  );
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [raterInfo, setRaterInfo] = useState<RaterInfo | null>(null);
  const [schema, setSchema] = useState<RatingColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<RatingTaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<RatingSentence[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [ratingChanges, setRatingChanges] = useState<Map<string, RatingUpdate>>(
    () => new Map(),
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unratedOnly, setUnratedOnly] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleUnauthorized = useCallback(() => {
    if (!raterId) return;
    clearRaterToken(raterId);
    setToken(null);
    setRaterInfo(null);
    setSelectedTaskId(null);
    setTasks([]);
    setSentences([]);
    setPage(1);
    setTotal(0);
    setRatingChanges(new Map());
    setAuthError("Invalid rater token. Please try again.");
  }, [raterId]);

  const loadSchema = useCallback(async () => {
    const response = await fetchRatingSchema();
    if (!response.ok) {
      throw new Error(`Failed to load rating schema (${response.status})`);
    }
    const data: RatingSchema = await response.json();
    setSchema(data.columns ?? []);
  }, []);

  const loadTasks = useCallback(async () => {
    if (!raterId) return;
    setLoading(true);
    setPageError(null);
    try {
      const response = await raterAuthFetch(raterId, `/rating/${raterId}/tasks`);
      if (!response.ok) {
        throw new Error(`Failed to load tasks (${response.status})`);
      }
      const data = await response.json();
      setTasks(data.tasks ?? []);
    } catch (err) {
      if (err instanceof RaterAuthError) {
        handleUnauthorized();
      } else {
        setPageError(err instanceof Error ? err.message : "Failed to load tasks.");
      }
    } finally {
      setLoading(false);
    }
  }, [raterId, handleUnauthorized]);

  const loadTaskDetail = useCallback(
    async (
      taskId: string,
      pageNumber = 1,
      changes: Map<string, RatingUpdate> = ratingChanges,
      filterUnrated = unratedOnly,
    ) => {
      if (!raterId) return;
      setLoading(true);
      setPageError(null);
      setSaveMessage(null);
      try {
        const params = new URLSearchParams({
          page: String(pageNumber),
          page_size: String(PAGE_SIZE),
        });
        if (filterUnrated) {
          params.set("unrated_only", "true");
        }
        const response = await raterAuthFetch(
          raterId,
          `/rating/${raterId}/tasks/${taskId}?${params.toString()}`,
        );
        if (!response.ok) {
          if (response.status === 403) {
            throw new Error("This task is not assigned to you.");
          }
          throw new Error(`Failed to load task (${response.status})`);
        }
        const data: RatingTaskDetail = await response.json();
        setSelectedTaskId(taskId);
        setPage(data.page ?? pageNumber);
        setTotal(data.total ?? 0);
        setSentences(mergeRatingChanges(data.sentences ?? [], changes));
      } catch (err) {
        if (err instanceof RaterAuthError) {
          handleUnauthorized();
        } else {
          setPageError(err instanceof Error ? err.message : "Failed to load task.");
        }
      } finally {
        setLoading(false);
      }
    },
    [raterId, ratingChanges, handleUnauthorized, unratedOnly],
  );

  const openTaskIfAssigned = useCallback(
    async (taskId: string, assignedTasks: string[]) => {
      if (!assignedTasks.includes(taskId)) {
        setPageError("This task is not assigned to you.");
        return;
      }
      setRatingChanges(new Map());
      setUnratedOnly(false);
      setPage(1);
      await loadTaskDetail(taskId, 1, new Map(), false);
    },
    [loadTaskDetail],
  );

  useEffect(() => {
    if (token && raterId) {
      loadSchema().catch((err) => {
        setPageError(err instanceof Error ? err.message : "Failed to load schema.");
      });
      loadTasks();
      raterAuthFetch(raterId, `/rating/${raterId}/verify`, { method: "POST" })
        .then(async (response) => {
          if (response.ok) {
            setRaterInfo(await response.json());
          }
        })
        .catch(() => {
          handleUnauthorized();
        });
    }
  }, [token, raterId, loadSchema, loadTasks, handleUnauthorized]);

  useEffect(() => {
    if (!token || !raterId || !urlTaskId || !raterInfo || selectedTaskId) {
      return;
    }
    openTaskIfAssigned(urlTaskId, raterInfo.tasks);
  }, [token, raterId, urlTaskId, raterInfo, selectedTaskId, openTaskIfAssigned]);

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!raterId) return;

    setAuthError(null);
    setLoading(true);

    try {
      const trimmedToken = tokenInput.trim();
      const response = await raterAuthFetch(
        raterId,
        `/rating/${raterId}/verify`,
        { method: "POST" },
        trimmedToken,
      );
      if (!response.ok) {
        throw new RaterAuthError("Invalid rater token.", response.status);
      }
      const data: RaterInfo = await response.json();
      setRaterToken(raterId, trimmedToken);
      setToken(trimmedToken);
      setTokenInput("");
      setRaterInfo(data);

      const schemaResponse = await fetchRatingSchema();
      if (schemaResponse.ok) {
        const schemaData: RatingSchema = await schemaResponse.json();
        setSchema(schemaData.columns ?? []);
      }

      const tasksResponse = await raterAuthFetch(
        raterId,
        `/rating/${raterId}/tasks`,
        {},
        trimmedToken,
      );
      if (tasksResponse.ok) {
        const tasksData = await tasksResponse.json();
        setTasks(tasksData.tasks ?? []);
      }
    } catch (err) {
      if (err instanceof RaterAuthError) {
        setAuthError("Invalid rater token.");
      } else {
        setAuthError("Unable to verify token.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLock = () => {
    if (!raterId) return;
    clearRaterToken(raterId);
    setToken(null);
    setRaterInfo(null);
    setSelectedTaskId(null);
    setTasks([]);
    setSentences([]);
    setPage(1);
    setTotal(0);
    setRatingChanges(new Map());
    setSaveMessage(null);
    setPageError(null);
  };

  const updateSentenceField = (
    sentenceId: string,
    key: string,
    value: RatingFieldValue,
  ) => {
    setSentences((prev) =>
      prev.map((sentence) =>
        sentence.sentenceId === sentenceId
          ? { ...sentence, fields: { ...sentence.fields, [key]: value } }
          : sentence,
      ),
    );
    setRatingChanges((prev) => {
      const next = new Map(prev);
      const existing = next.get(sentenceId);
      next.set(sentenceId, {
        sentenceId,
        fields: { ...(existing?.fields ?? {}), [key]: value },
      });
      return next;
    });
    setSaveMessage(null);
  };

  const handleSaveRatings = async () => {
    if (!raterId || !selectedTaskId || ratingChanges.size === 0) return;

    const updates = Array.from(ratingChanges.values());

    setLoading(true);
    setPageError(null);
    try {
      const response = await raterAuthFetch(
        raterId,
        `/rating/${raterId}/tasks/${selectedTaskId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to save ratings (${response.status})`);
      }
      setSaveMessage("Ratings saved.");
      setRatingChanges(new Map());
      await loadTasks();
      await loadTaskDetail(selectedTaskId, page, new Map());
    } catch (err) {
      if (err instanceof RaterAuthError) {
        handleUnauthorized();
      } else {
        setPageError(err instanceof Error ? err.message : "Failed to save ratings.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (!selectedTaskId || newPage < 1 || newPage > totalPages || newPage === page) {
      return;
    }
    loadTaskDetail(selectedTaskId, newPage);
  };

  const handleDetailUnratedOnlyChange = (checked: boolean) => {
    setUnratedOnly(checked);
    if (!selectedTaskId) return;
    setPage(1);
    loadTaskDetail(selectedTaskId, 1, ratingChanges, checked);
  };

  if (!raterId) {
    return (
      <Container className="my-5">
        <Alert variant="danger">Missing rater ID in URL.</Alert>
      </Container>
    );
  }

  if (!token) {
    return (
      <Container className="my-5" style={{ maxWidth: "480px" }}>
        <h1 className="mb-4 text-center">Rater Access</h1>
        <p className="text-muted text-center">
          Enter your rater token to review assigned recordings.
        </p>
        <Form onSubmit={handleUnlock}>
          <Form.Group className="mb-3">
            <Form.Label>Rater ID</Form.Label>
            <Form.Control value={raterId} disabled readOnly />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Rater token</Form.Label>
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

  const title = raterInfo?.displayName
    ? `Rating — ${raterInfo.displayName}`
    : `Rating — ${raterId}`;

  return (
    <Container className="my-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>{title}</h1>
        <Button variant="outline-secondary" onClick={handleLock}>
          Lock
        </Button>
      </div>

      {pageError && <Alert variant="danger">{pageError}</Alert>}
      {saveMessage && <Alert variant="success">{saveMessage}</Alert>}

      {!selectedTaskId ? (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h4 mb-0">Assigned tasks</h2>
          </div>
          {loading && tasks.length === 0 ? (
            <p>Loading tasks...</p>
          ) : tasks.length === 0 ? (
            <p>No tasks assigned.</p>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assigned</th>
                  <th>Valid audio</th>
                  <th>Missing</th>
                  <th>Rated</th>
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
                    <td>{task.rated}</td>
                    <td>{task.pendingRatings}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => {
                          setRatingChanges(new Map());
                          setUnratedOnly(false);
                          setPage(1);
                          loadTaskDetail(task.taskId, 1, new Map(), false);
                        }}
                        disabled={!task.hasSubmissions}
                      >
                        Rate
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
                  setPage(1);
                  setTotal(0);
                  setRatingChanges(new Map());
                  setSaveMessage(null);
                }}
              >
                Back to tasks
              </Button>
              <span className="h4 mb-0">Task: {selectedTaskId}</span>
            </div>
            <div className="d-flex align-items-center gap-3">
              <Form.Check
                type="switch"
                id="unrated-filter"
                label="Show unrated only"
                checked={unratedOnly}
                disabled={loading}
                onChange={(event) =>
                  handleDetailUnratedOnlyChange(event.target.checked)
                }
              />
              <Button
                variant="primary"
                onClick={handleSaveRatings}
                disabled={loading || ratingChanges.size === 0}
              >
                Save ratings
                {ratingChanges.size > 0 ? ` (${ratingChanges.size} unsaved)` : ""}
              </Button>
            </div>
          </div>

          {unratedOnly && sentences.length === 0 ? (
            <p className="text-muted">No unrated sentences in this task.</p>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Sentence</th>
                  <th>Audio</th>
                  {schema.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sentences.map((sentence) => (
                  <tr key={sentence.sentenceId}>
                    <td>
                      <FormattedSentence sentence={sentence.sentence} />
                    </td>
                    <td>
                      {sentence.hasAudio && sentence.audioUrl ? (
                        <RaterAudio raterId={raterId} audioUrl={sentence.audioUrl} />
                      ) : (
                        <span className="text-muted">No audio</span>
                      )}
                    </td>
                    {schema.map((column) => (
                      <td key={column.key}>
                        <RatingCell
                          column={column}
                          value={sentence.fields[column.key] ?? null}
                          onChange={(value) =>
                            updateSentenceField(sentence.sentenceId, column.key, value)
                          }
                          disabled={loading}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <div className="d-flex justify-content-between align-items-center mt-3">
            <span className="text-muted">
              Page {page} of {totalPages}
              {unratedOnly ? ` (${total} unrated)` : ` (${total} sentences)`}
            </span>
            <Pagination className="mb-0">
              <Pagination.Prev
                disabled={page <= 1 || loading}
                onClick={() => handlePageChange(page - 1)}
              />
              {getVisiblePages(page, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <Pagination.Ellipsis key={`ellipsis-${index}`} disabled />
                ) : (
                  <Pagination.Item
                    key={item}
                    active={item === page}
                    disabled={loading}
                    onClick={() => handlePageChange(item)}
                  >
                    {item}
                  </Pagination.Item>
                ),
              )}
              <Pagination.Next
                disabled={page >= totalPages || loading}
                onClick={() => handlePageChange(page + 1)}
              />
            </Pagination>
          </div>
        </>
      )}
    </Container>
  );
};

export default Rating;
