from datetime import datetime, timezone
import base64
import json
import os
import re
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()

with open("app/config.json") as f:
    app_config = json.load(f)

origins = app_config["origins"]
VALIDATION_TOKEN = os.environ.get("VALIDATION_TOKEN") or app_config.get(
    "validationToken", ""
)

DATA_DIR = Path("data")
JSON_DIR = DATA_DIR / "json"
AUDIO_DIR = DATA_DIR / "audio"
REVIEWS_DIR = DATA_DIR / "reviews"
AUDIO_EXT = ".webm"
MIN_AUDIO_BYTES = 1024
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not VALIDATION_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Validation token is not configured on the server.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token.")
    token = authorization.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(token, VALIDATION_TOKEN):
        raise HTTPException(status_code=401, detail="Missing or invalid token.")


def sanitize_id(value: str, label: str) -> str:
    if not SAFE_ID_PATTERN.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def load_task_ids(json_path: Path) -> tuple[list[str], list[str]]:
    with json_path.open(encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise HTTPException(
            status_code=400,
            detail=f"Expected a JSON array in {json_path.name}.",
        )

    seen: set[str] = set()
    ordered: list[str] = []
    duplicates: list[str] = []
    for i, entry in enumerate(data):
        if not isinstance(entry, dict) or "sentenceId" not in entry:
            raise HTTPException(
                status_code=400,
                detail=f"Entry #{i} in {json_path.name} is missing 'sentenceId'.",
            )
        sid = entry["sentenceId"]
        if sid in seen:
            duplicates.append(sid)
            continue
        seen.add(sid)
        ordered.append(sid)
    return ordered, duplicates


def validate_submission(json_path: Path, audio_dir: Path) -> dict:
    task_ids, duplicates = load_task_ids(json_path)
    task_id_set = set(task_ids)

    missing: list[str] = []
    empty: list[str] = []
    valid = 0

    for sid in task_ids:
        audio_file = audio_dir / f"{sid}{AUDIO_EXT}"
        if not audio_file.is_file():
            missing.append(sid)
            continue
        size = audio_file.stat().st_size
        if size == 0 or size < MIN_AUDIO_BYTES:
            empty.append(sid)
            continue
        valid += 1

    extra: list[str] = []
    if audio_dir.is_dir():
        for audio_file in sorted(audio_dir.glob(f"*{AUDIO_EXT}")):
            if audio_file.stem not in task_id_set:
                extra.append(audio_file.name)

    return {
        "assigned": len(task_ids),
        "validAudio": valid,
        "missing": len(missing),
        "empty": len(empty),
        "extra": len(extra),
        "duplicates": len(duplicates),
    }


def load_reviews(task_id: str) -> dict[str, dict]:
    review_path = REVIEWS_DIR / f"{task_id}.json"
    if not review_path.is_file():
        return {}
    with review_path.open(encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def count_review_progress(reviews: dict[str, dict], task_ids: list[str]) -> dict:
    reviewed = 0
    valid = 0
    invalid = 0
    for sid in task_ids:
        review = reviews.get(sid, {})
        status = review.get("status", "pending")
        if status != "pending":
            reviewed += 1
        if status == "valid":
            valid += 1
        elif status == "invalid":
            invalid += 1
    return {
        "reviewed": reviewed,
        "validReviews": valid,
        "invalidReviews": invalid,
        "pendingReviews": len(task_ids) - reviewed,
    }


@app.get("/", tags=["root"])
async def read_root() -> dict:
    return {"message": "connected to backend"}


@app.get("/read-json/{task_id}")
def read_json(task_id: str):
    json_dir = Path("data/json")
    try:
        json_file = json_dir / f"{task_id}.json"
        with open(json_file, "r", encoding="utf-8") as f:
            content = json.load(f)

        return JSONResponse(content)

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON format: {task_id}.json."
        )


class Recording(BaseModel):
    sentenceId: str
    audioUrl: str


@app.post("/submit-recordings/{task_id}")
async def submit_recordings(recordings: list[Recording], task_id: str):
    audio_dir = Path(f"data/audio/{task_id}")
    audio_dir.mkdir(parents=True, exist_ok=True)

    if not recordings:
        raise HTTPException(status_code=400, detail="No recordings provided.")

    try:
        for recording in recordings:
            with open(audio_dir / f"{recording.sentenceId}.webm", "wb") as f:
                f.write(base64.b64decode(recording.audioUrl.split(",")[1]))
        return {"message": "Recordings submitted successfully."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Submission failed: {str(e)}")


class ReviewUpdate(BaseModel):
    sentenceId: str
    status: str = Field(pattern="^(valid|invalid|pending)$")
    note: str | None = None


@app.get("/validation/tasks", dependencies=[Depends(require_token)])
def list_validation_tasks():
    tasks = []
    if not JSON_DIR.is_dir():
        return {"tasks": tasks}

    for json_file in sorted(JSON_DIR.glob("*.json")):
        task_id = json_file.stem
        audio_dir = AUDIO_DIR / task_id
        summary = validate_submission(json_file, audio_dir)
        task_ids, _ = load_task_ids(json_file)
        reviews = load_reviews(task_id)
        review_progress = count_review_progress(reviews, task_ids)
        has_submissions = audio_dir.is_dir() and any(audio_dir.glob(f"*{AUDIO_EXT}"))

        tasks.append(
            {
                "taskId": task_id,
                "hasSubmissions": has_submissions,
                **summary,
                **review_progress,
            }
        )

    return {"tasks": tasks}


@app.get("/validation/tasks/{task_id}", dependencies=[Depends(require_token)])
def get_validation_task(task_id: str):
    task_id = sanitize_id(task_id, "task_id")
    json_path = JSON_DIR / f"{task_id}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    with json_path.open(encoding="utf-8") as f:
        assignments = json.load(f)

    audio_dir = AUDIO_DIR / task_id
    reviews = load_reviews(task_id)
    sentences = []

    for entry in assignments:
        sentence_id = entry["sentenceId"]
        audio_file = audio_dir / f"{sentence_id}{AUDIO_EXT}"
        has_audio = audio_file.is_file()
        audio_size = audio_file.stat().st_size if has_audio else 0
        review = reviews.get(
            sentence_id,
            {"status": "pending", "note": None, "updatedAt": None},
        )

        sentences.append(
            {
                "sentenceId": sentence_id,
                "sentence": entry.get("sentence", ""),
                "hasAudio": has_audio,
                "audioSize": audio_size,
                "audioUrl": (
                    f"/validation/audio/{task_id}/{sentence_id}" if has_audio else None
                ),
                "status": review.get("status", "pending"),
                "note": review.get("note"),
                "updatedAt": review.get("updatedAt"),
            }
        )

    return {"taskId": task_id, "sentences": sentences}


@app.get(
    "/validation/audio/{task_id}/{sentence_id}",
    dependencies=[Depends(require_token)],
)
def get_validation_audio(task_id: str, sentence_id: str):
    task_id = sanitize_id(task_id, "task_id")
    sentence_id = sanitize_id(sentence_id, "sentence_id")
    audio_file = AUDIO_DIR / task_id / f"{sentence_id}{AUDIO_EXT}"
    if not audio_file.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(audio_file, media_type="audio/webm")


@app.post("/validation/review/{task_id}", dependencies=[Depends(require_token)])
def save_validation_reviews(task_id: str, updates: list[ReviewUpdate]):
    task_id = sanitize_id(task_id, "task_id")
    json_path = JSON_DIR / f"{task_id}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    task_ids, _ = load_task_ids(json_path)
    task_id_set = set(task_ids)
    reviews = load_reviews(task_id)
    now = datetime.now(timezone.utc).isoformat()

    for update in updates:
        if update.sentenceId not in task_id_set:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown sentenceId: {update.sentenceId}",
            )
        reviews[update.sentenceId] = {
            "status": update.status,
            "note": update.note,
            "updatedAt": now,
        }

    REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    review_path = REVIEWS_DIR / f"{task_id}.json"
    with review_path.open("w", encoding="utf-8") as f:
        json.dump(reviews, f, indent=2)

    return {"message": "Reviews saved.", "updated": len(updates)}
