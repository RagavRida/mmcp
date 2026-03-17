"""
MMCP v2 — Skill Engine.

Save, load, and fuzzy-match reusable pipeline skills.
Skills are saved execution plans stored in ~/.mmcp/skills/.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

from .planner import ExecutionPlan, PlanStep


SKILLS_DIR = Path.home() / ".mmcp" / "skills"


def _ensure_dir() -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _slug(name: str) -> str:
    """Convert name to filename-safe slug."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


# ── Save / Load ────────────────────────────────────────────────────────────

def save_skill(name: str, plan: ExecutionPlan) -> str:
    """Save an execution plan as a reusable skill."""
    _ensure_dir()
    slug = _slug(name)
    path = SKILLS_DIR / f"{slug}.json"

    skill_data = {
        "name": name,
        "task": plan.task,
        "steps": [
            {
                "step": s.step,
                "action": s.action,
                "description": s.description,
                "prompt": s.prompt,
                "tool_name": s.tool_name,
                "tool_args": s.tool_args,
                "depends_on": s.depends_on,
            }
            for s in plan.steps
        ],
    }

    path.write_text(json.dumps(skill_data, indent=2), encoding="utf-8")
    return str(path)


def load_skill(name: str) -> ExecutionPlan | None:
    """Load a skill by exact name."""
    _ensure_dir()
    slug = _slug(name)
    path = SKILLS_DIR / f"{slug}.json"

    if not path.exists():
        return None

    data = json.loads(path.read_text(encoding="utf-8"))
    steps = [
        PlanStep(
            step=s["step"],
            action=s["action"],
            description=s.get("description", ""),
            prompt=s.get("prompt"),
            tool_name=s.get("tool_name"),
            tool_args=s.get("tool_args", {}),
            depends_on=s.get("depends_on", []),
        )
        for s in data["steps"]
    ]
    return ExecutionPlan(task=data.get("task", ""), steps=steps)


def list_skills() -> list[dict]:
    """List all saved skills."""
    _ensure_dir()
    skills = []
    for path in sorted(SKILLS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            skills.append({
                "name": data.get("name", path.stem),
                "task": data.get("task", ""),
                "steps": len(data.get("steps", [])),
                "file": str(path),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return skills


def delete_skill(name: str) -> bool:
    """Delete a saved skill."""
    slug = _slug(name)
    path = SKILLS_DIR / f"{slug}.json"
    if path.exists():
        path.unlink()
        return True
    return False


# ── Fuzzy Matching ──────────────────────────────────────────────────────────

def _tokenize(text: str) -> set[str]:
    """Simple word tokenization for fuzzy matching."""
    return set(re.findall(r"[a-z]+", text.lower()))


def _jaccard_similarity(a: set, b: set) -> float:
    """Jaccard similarity between two token sets."""
    if not a or not b:
        return 0.0
    intersection = a & b
    union = a | b
    return len(intersection) / len(union)


def find_similar_skill(task: str, threshold: float = 0.35) -> dict | None:
    """
    Find a saved skill that's similar to the given task.

    Uses Jaccard similarity on word tokens.
    Threshold of 0.35 means ~35% word overlap needed.
    Returns the best match above threshold, or None.
    """
    task_tokens = _tokenize(task)
    if not task_tokens:
        return None

    best_match = None
    best_score = 0.0

    for skill in list_skills():
        # Compare against both skill name and original task
        name_tokens = _tokenize(skill["name"])
        task_tokens_saved = _tokenize(skill["task"])

        # Take the higher similarity
        name_sim = _jaccard_similarity(task_tokens, name_tokens)
        task_sim = _jaccard_similarity(task_tokens, task_tokens_saved)
        score = max(name_sim, task_sim)

        if score > best_score:
            best_score = score
            best_match = {**skill, "similarity": round(score, 3)}

    if best_match and best_score >= threshold:
        return best_match

    return None
