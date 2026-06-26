# Sentence Recorder

This is a tool to collect read audio given sentences to record.

Json files that contain the sentences should be placed at `backend/data/json/{task_id}.json` with the following format:

```json
[
    {
        "sentenceId": "sample1_sentence1",
        "sentence": "This is sample sentence 1 from sample1.json."
    },
    {
        "sentenceId": "sample1_sentence2",
        "sentence": "She is helping the boy {b}bear{/b} his shoes."
    }
]
```

Sentences may contain `{b}word{/b}` tags to bold the error word. The UI renders these as bold text.

Users can access the web app at `{frontend_url}/task/{task_id}` (e.g., http://localhost:5173/task/sample1), where they can record the audio sentence by sentence, check the audio, and submit the audio of their choosing.

The submitted audio will be saved as `backend/data/audio/{task_id}/{sentenceId}.webm` in the [Opus](https://opus-codec.org/) format.

## Rater review

Hired raters use a separate rating flow from internal validation. Each rater gets a unique ID, personal token, and assigned task list. The rating UI shows only sentences **without** `{b}...{/b}` bold markers (error-word sentences are excluded).

### Setup a rater

Create a manifest at `backend/data/raters/{rater_id}.json`:

```json
{
  "raterId": "rater-001",
  "displayName": "Jane Doe",
  "token": "change-me-before-deploy",
  "tasks": ["0090-test", "0090-dev-answer"]
}
```

Set a strong token before sharing links. The rater ID in the URL must match the filename stem.

### Rater URLs

| URL | Purpose |
|-----|---------|
| `{frontend_url}/rate/{rater_id}` | Task list after token unlock |
| `{frontend_url}/rate/{rater_id}/{task_id}` | Direct link to one assigned task |

Example: `http://localhost:5173/rate/rater-001/0090-test`

### Rating schema

Column definitions live in `backend/data/rating_schema.json`. The UI renders columns from this file; saves are validated against it.

```json
{
  "columns": [
    { "key": "wouldCorrect", "label": "Would they correct it?", "type": "yes_no", "required": true },
    { "key": "comment", "label": "Comment", "type": "text", "required": false }
  ]
}
```

Supported types: `yes_no` (Yes/No buttons), `text` (textarea). To add a column, append an entry and redeploy — no frontend code changes needed.

### Saved ratings

Each rater's ratings are stored separately at `backend/data/ratings/{rater_id}/{task_id}.json`:

```json
{
  "0090-test_answer_a47": {
    "wouldCorrect": "yes",
    "comment": "Clear correction",
    "updatedAt": "2026-06-26T12:00:00+00:00"
  }
}
```
