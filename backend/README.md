# Recorder Backend

Backend reads the json files and provides the content to the frontend, and handles submitted recordings.
The code is written with [Python](https://www.python.org/) + [FastAPI](https://fastapi.tiangolo.com/), with [uv](https://docs.astral.sh/uv/) as the package manager. 

## Installation

- Follow the [docs](https://docs.astral.sh/uv/getting-started/installation/) to install uv.

- To install the dependencies for this project, run:

    ```
    uv sync
    ```

## Development

- To start the development server, run:

    ```
    uv run main.py
    ```

    The app runs on [http://localhost:8000](http://localhost:8000) by default.

## Validation access

The validation UI is protected by a static token. Set it via environment variable before starting the backend:

```
VALIDATION_TOKEN=your-secret-token uv run main.py
```

Alternatively, add a `validationToken` field to `app/config.json`.

Open the frontend validation page at [http://localhost:5173/validation](http://localhost:5173/validation), enter the token once, and the browser stores it in `localStorage` for subsequent requests.

Validation review decisions are saved to `data/reviews/{task_id}.json`.

- For linting, run:

    ```
    uv run ruff check
    ```

- For formatting, run:

    ```
    uv run ruff format
    ```
