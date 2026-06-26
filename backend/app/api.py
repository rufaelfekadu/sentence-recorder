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
RATERS_DIR = DATA_DIR / "raters"
RATINGS_DIR = DATA_DIR / "ratings"
RATING_SCHEMA_PATH = DATA_DIR / "rating_schema.json"
AUDIO_EXT = ".webm"
MIN_AUDIO_BYTES = 1024
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")
BOLD_MARKER_PATTERN = re.compile(r"\{b\}.*?\{/b\}")

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


def has_valid_submission(task_id: str, sentence_id: str) -> bool:
    task_id = sanitize_id(task_id, "task_id")
    audio_file = AUDIO_DIR / task_id / f"{sentence_id}{AUDIO_EXT}"
    return audio_file.is_file() and audio_file.stat().st_size >= MIN_AUDIO_BYTES


def filter_unsubmitted(task_id: str, assignments: list) -> list:
    return [
        entry
        for entry in assignments
        if isinstance(entry, dict)
        and "sentenceId" in entry
        and not has_valid_submission(task_id, entry["sentenceId"])
    ]


def enrich_with_submission_status(task_id: str, assignments: list) -> list:
    task_id = sanitize_id(task_id, "task_id")
    enriched = []
    for entry in assignments:
        if not isinstance(entry, dict) or "sentenceId" not in entry:
            enriched.append(entry)
            continue
        sentence_id = entry["sentenceId"]
        has_submitted = has_valid_submission(task_id, sentence_id)
        enriched.append(
            {
                **entry,
                "hasSubmitted": has_submitted,
                "submittedAudioUrl": (
                    f"/recordings/{task_id}/{sentence_id}" if has_submitted else None
                ),
            }
        )
    return enriched


def count_submitted(task_id: str, assignments: list) -> int:
    submitted = 0
    for entry in assignments:
        if not isinstance(entry, dict) or "sentenceId" not in entry:
            continue
        if has_valid_submission(task_id, entry["sentenceId"]):
            submitted += 1
    return submitted


@app.get("/read-json/{task_id}")
def read_json(
    task_id: str,
    page: int = 1,
    page_size: int = 111,
    unsubmitted_only: bool = False,
):
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=400, detail="page_size must be between 1 and 200")

    task_id = sanitize_id(task_id, "task_id")
    json_file = JSON_DIR / f"{task_id}.json"
    try:
        with json_file.open(encoding="utf-8") as f:
            content = json.load(f)

        if not isinstance(content, list):
            raise HTTPException(
                status_code=400, detail=f"Invalid JSON format: {task_id}.json."
            )

        submitted_count = count_submitted(task_id, content)
        filtered_content = (
            filter_unsubmitted(task_id, content) if unsubmitted_only else content
        )
        assigned_total = len(content)
        total = len(filtered_content)
        start = (page - 1) * page_size
        page_content = filtered_content[start : start + page_size]
        sentences = enrich_with_submission_status(task_id, page_content)

        return JSONResponse(
            {
                "taskId": task_id,
                "sentences": sentences,
                "total": total,
                "assignedTotal": assigned_total,
                "submittedCount": submitted_count,
                "page": page,
                "pageSize": page_size,
            }
        )

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


@app.get("/recordings/{task_id}/{sentence_id}")
def get_recording_audio(task_id: str, sentence_id: str):
    task_id = sanitize_id(task_id, "task_id")
    sentence_id = sanitize_id(sentence_id, "sentence_id")
    audio_file = AUDIO_DIR / task_id / f"{sentence_id}{AUDIO_EXT}"
    if not audio_file.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(audio_file, media_type="audio/webm")


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
def get_validation_task(
    task_id: str,
    page: int = 1,
    page_size: int = 111,
    unsubmitted_only: bool = False,
):
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=400, detail="page_size must be between 1 and 200")

    task_id = sanitize_id(task_id, "task_id")
    json_path = JSON_DIR / f"{task_id}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    with json_path.open(encoding="utf-8") as f:
        assignments = json.load(f)

    filtered_assignments = (
        filter_unsubmitted(task_id, assignments) if unsubmitted_only else assignments
    )
    total = len(filtered_assignments)
    start = (page - 1) * page_size
    page_assignments = filtered_assignments[start : start + page_size]

    audio_dir = AUDIO_DIR / task_id
    reviews = load_reviews(task_id)
    sentences = []

    for entry in page_assignments:
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

    return {
        "taskId": task_id,
        "sentences": sentences,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


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


def load_rater_manifest(rater_id: str) -> dict:
    rater_id = sanitize_id(rater_id, "rater_id")
    manifest_path = RATERS_DIR / f"{rater_id}.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=404, detail=f"Rater not found: {rater_id}")
    with manifest_path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="Invalid rater manifest format.")
    token = data.get("token")
    tasks = data.get("tasks")
    if not token or not isinstance(tasks, list):
        raise HTTPException(status_code=500, detail="Rater manifest missing token or tasks.")
    return data


def verify_rater_token(rater_id: str, authorization: str | None) -> dict:
    manifest = load_rater_manifest(rater_id)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token.")
    token = authorization.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(token, manifest["token"]):
        raise HTTPException(status_code=401, detail="Missing or invalid token.")
    return manifest


def get_rater_manifest(
    rater_id: str,
    authorization: str | None = Header(default=None),
) -> dict:
    return verify_rater_token(rater_id, authorization)


def ensure_task_assigned(manifest: dict, task_id: str) -> None:
    assigned = manifest.get("tasks", [])
    if task_id not in assigned:
        raise HTTPException(status_code=403, detail=f"Task not assigned to rater: {task_id}")


def load_rating_schema() -> dict:
    if not RATING_SCHEMA_PATH.is_file():
        raise HTTPException(status_code=503, detail="Rating schema is not configured.")
    with RATING_SCHEMA_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("columns"), list):
        raise HTTPException(status_code=500, detail="Invalid rating schema format.")
    return data


def load_ratings(rater_id: str, task_id: str) -> dict[str, dict]:
    rating_path = RATINGS_DIR / rater_id / f"{task_id}.json"
    if not rating_path.is_file():
        return {}
    with rating_path.open(encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def is_rating_complete(rating: dict, schema: dict) -> bool:
    for column in schema.get("columns", []):
        if not column.get("required"):
            continue
        key = column["key"]
        value = rating.get(key)
        if value is None or value == "":
            return False
    return True


def count_rating_progress(
    ratings: dict[str, dict], task_ids: list[str], schema: dict
) -> dict:
    rated = 0
    for sid in task_ids:
        if is_rating_complete(ratings.get(sid, {}), schema):
            rated += 1
    return {
        "rated": rated,
        "pendingRatings": len(task_ids) - rated,
    }


def validate_rating_fields(fields: dict, schema: dict) -> dict:
    columns = schema.get("columns", [])
    column_map = {col["key"]: col for col in columns}
    validated: dict = {}

    for key, value in fields.items():
        if key not in column_map:
            raise HTTPException(status_code=400, detail=f"Unknown rating field: {key}")
        col = column_map[key]
        col_type = col.get("type")
        if col_type == "yes_no":
            if value is not None and value not in ("yes", "no"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Field {key} must be 'yes', 'no', or null.",
                )
        elif col_type == "text":
            if value is not None and not isinstance(value, str):
                raise HTTPException(
                    status_code=400,
                    detail=f"Field {key} must be a string or null.",
                )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported column type for {key}: {col_type}",
            )
        validated[key] = value

    return validated


def has_bold_marker(sentence: str) -> bool:
    return bool(BOLD_MARKER_PATTERN.search(sentence))


def filter_rateable_assignments(assignments: list) -> list:
    return [
        entry
        for entry in assignments
        if isinstance(entry, dict)
        and "sentenceId" in entry
        and not has_bold_marker(entry.get("sentence", ""))
    ]


def summarize_rateable(task_id: str, assignments: list) -> dict:
    task_id = sanitize_id(task_id, "task_id")
    audio_dir = AUDIO_DIR / task_id
    missing = 0
    empty = 0
    valid = 0
    assigned = 0

    for entry in assignments:
        if not isinstance(entry, dict) or "sentenceId" not in entry:
            continue
        assigned += 1
        sentence_id = entry["sentenceId"]
        audio_file = audio_dir / f"{sentence_id}{AUDIO_EXT}"
        if not audio_file.is_file():
            missing += 1
            continue
        size = audio_file.stat().st_size
        if size == 0 or size < MIN_AUDIO_BYTES:
            empty += 1
            continue
        valid += 1

    return {
        "assigned": assigned,
        "validAudio": valid,
        "missing": missing,
        "empty": empty,
        "extra": 0,
        "duplicates": 0,
    }


def filter_unrated(
    rater_id: str, task_id: str, assignments: list, schema: dict
) -> list:
    ratings = load_ratings(rater_id, task_id)
    return [
        entry
        for entry in assignments
        if isinstance(entry, dict)
        and "sentenceId" in entry
        and not is_rating_complete(ratings.get(entry["sentenceId"], {}), schema)
    ]


def rating_fields_from_entry(entry: dict, schema: dict) -> dict:
    columns = schema.get("columns", [])
    fields = {}
    for col in columns:
        key = col["key"]
        fields[key] = entry.get(key)
    return fields


@app.get("/rating/schema")
def get_rating_schema():
    return load_rating_schema()


@app.post("/rating/{rater_id}/verify")
def verify_rater(rater_id: str, authorization: str | None = Header(default=None)):
    manifest = verify_rater_token(rater_id, authorization)
    return {
        "raterId": manifest.get("raterId", rater_id),
        "displayName": manifest.get("displayName"),
        "tasks": manifest.get("tasks", []),
    }


@app.get("/rating/{rater_id}/tasks")
def list_rater_tasks(
    rater_id: str,
    manifest: dict = Depends(get_rater_manifest),
):
    schema = load_rating_schema()
    tasks = []
    for task_id in manifest.get("tasks", []):
        task_id = sanitize_id(task_id, "task_id")
        json_path = JSON_DIR / f"{task_id}.json"
        if not json_path.is_file():
            continue
        with json_path.open(encoding="utf-8") as f:
            assignments = json.load(f)
        rateable = filter_rateable_assignments(assignments)
        rateable_ids = [entry["sentenceId"] for entry in rateable]
        summary = summarize_rateable(task_id, rateable)
        ratings = load_ratings(rater_id, task_id)
        rating_progress = count_rating_progress(ratings, rateable_ids, schema)
        has_submissions = summary["validAudio"] > 0

        tasks.append(
            {
                "taskId": task_id,
                "hasSubmissions": has_submissions,
                **summary,
                **rating_progress,
            }
        )

    return {"tasks": tasks}


@app.get("/rating/{rater_id}/tasks/{task_id}")
def get_rater_task(
    rater_id: str,
    task_id: str,
    page: int = 1,
    page_size: int = 111,
    unrated_only: bool = False,
    manifest: dict = Depends(get_rater_manifest),
):
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=400, detail="page_size must be between 1 and 200")

    task_id = sanitize_id(task_id, "task_id")
    ensure_task_assigned(manifest, task_id)

    json_path = JSON_DIR / f"{task_id}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    schema = load_rating_schema()

    with json_path.open(encoding="utf-8") as f:
        assignments = json.load(f)

    rateable = filter_rateable_assignments(assignments)
    filtered_assignments = (
        filter_unrated(rater_id, task_id, rateable, schema)
        if unrated_only
        else rateable
    )
    total = len(filtered_assignments)
    start = (page - 1) * page_size
    page_assignments = filtered_assignments[start : start + page_size]

    audio_dir = AUDIO_DIR / task_id
    ratings = load_ratings(rater_id, task_id)
    sentences = []

    for entry in page_assignments:
        sentence_id = entry["sentenceId"]
        audio_file = audio_dir / f"{sentence_id}{AUDIO_EXT}"
        has_audio = audio_file.is_file()
        audio_size = audio_file.stat().st_size if has_audio else 0
        rating_entry = ratings.get(sentence_id, {})
        fields = rating_fields_from_entry(rating_entry, schema)

        sentences.append(
            {
                "sentenceId": sentence_id,
                "sentence": entry.get("sentence", ""),
                "hasAudio": has_audio,
                "audioSize": audio_size,
                "audioUrl": (
                    f"/rating/{rater_id}/audio/{task_id}/{sentence_id}"
                    if has_audio
                    else None
                ),
                "fields": fields,
                "updatedAt": rating_entry.get("updatedAt"),
            }
        )

    return {
        "taskId": task_id,
        "sentences": sentences,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@app.get("/rating/{rater_id}/audio/{task_id}/{sentence_id}")
def get_rater_audio(
    rater_id: str,
    task_id: str,
    sentence_id: str,
    manifest: dict = Depends(get_rater_manifest),
):
    task_id = sanitize_id(task_id, "task_id")
    sentence_id = sanitize_id(sentence_id, "sentence_id")
    ensure_task_assigned(manifest, task_id)
    audio_file = AUDIO_DIR / task_id / f"{sentence_id}{AUDIO_EXT}"
    if not audio_file.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(audio_file, media_type="audio/webm")


class RatingUpdate(BaseModel):
    sentenceId: str
    fields: dict


@app.post("/rating/{rater_id}/tasks/{task_id}")
def save_rater_ratings(
    rater_id: str,
    task_id: str,
    updates: list[RatingUpdate],
    manifest: dict = Depends(get_rater_manifest),
):
    task_id = sanitize_id(task_id, "task_id")
    ensure_task_assigned(manifest, task_id)

    json_path = JSON_DIR / f"{task_id}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    schema = load_rating_schema()
    task_ids, _ = load_task_ids(json_path)
    task_id_set = set(task_ids)
    ratings = load_ratings(rater_id, task_id)
    now = datetime.now(timezone.utc).isoformat()

    for update in updates:
        if update.sentenceId not in task_id_set:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown sentenceId: {update.sentenceId}",
            )
        validated_fields = validate_rating_fields(update.fields, schema)
        existing = ratings.get(update.sentenceId, {})
        ratings[update.sentenceId] = {
            **existing,
            **validated_fields,
            "updatedAt": now,
        }

    rating_dir = RATINGS_DIR / rater_id
    rating_dir.mkdir(parents=True, exist_ok=True)
    rating_path = rating_dir / f"{task_id}.json"
    with rating_path.open("w", encoding="utf-8") as f:
        json.dump(ratings, f, indent=2)

    return {"message": "Ratings saved.", "updated": len(updates)}
