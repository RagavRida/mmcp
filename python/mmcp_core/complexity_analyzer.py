"""
MMCP v2.2 — Task Complexity Analyzer.

Classifies task complexity using heuristic signals to route to the right
model tier. No LLM call needed — pure keyword/pattern analysis.

All signal tables and domain keywords are loaded from MMCPConfig.
Nothing is hardcoded — override via config file or programmatic API.

Complexity Tiers:
  TRIVIAL   → Simple lookups, formatting, translation
  STANDARD  → Writing, summarization, basic analysis
  COMPLEX   → Multi-step reasoning, code generation, architecture
  FRONTIER  → Research-grade reasoning, math proofs, security audits
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from .types import TaskComplexity


# ── Analysis Result ─────────────────────────────────────────────────────────

@dataclass
class ComplexityResult:
    """Result of task complexity analysis."""
    complexity: TaskComplexity
    domain: str
    confidence: float               # 0.0-1.0
    signals_found: list[str]        # Which signals triggered
    reasoning: str                  # Human-readable explanation
    estimated_tokens: int           # Rough output token estimate
    scores: dict[str, float] = field(default_factory=dict)


# ── Analyzer ────────────────────────────────────────────────────────────────

def _count_signal_hits(text: str, signals: list[str]) -> list[str]:
    """Count how many signals match in the text."""
    text_lower = text.lower()
    return [s for s in signals if s in text_lower]


def _estimate_output_tokens(task: str) -> int:
    """Estimate expected output tokens based on task characteristics."""
    task_lower = task.lower()

    # Explicit length hints in the task
    if any(w in task_lower for w in ["one word", "one sentence", "short"]):
        return 50
    if any(w in task_lower for w in ["paragraph", "brief"]):
        return 200
    if any(w in task_lower for w in ["essay", "article", "blog post", "detailed"]):
        return 1500
    if any(w in task_lower for w in ["comprehensive", "full", "complete", "in depth"]):
        return 3000

    # Default: proportional to input length
    input_words = len(task.split())
    return max(200, input_words * 10)


def _detect_reasoning_depth(task: str) -> int:
    """Estimate reasoning depth (1-5) from task description."""
    depth = 1
    task_lower = task.lower()

    if re.search(r"\b(step[s]?\s+\d|multi[- ]step|chain)", task_lower):
        depth += 2
    if re.search(r"\b(then|after that|next|finally|first.*then)", task_lower):
        depth += 1
    if re.search(r"\b(if.*then|consider.*case|edge case|corner case)", task_lower):
        depth += 1
    if re.search(r"\b(compare|versus|vs\.|trade-?off|pros.*cons)", task_lower):
        depth += 1
    if any(w in task_lower for w in ["deep", "thorough", "comprehensive", "exhaustive"]):
        depth += 1

    return min(depth, 5)


def detect_domain(task: str, config: object | None = None) -> str:
    """
    Detect the primary domain of a task from keywords.

    Args:
        task: The task description
        config: Optional MMCPConfig — if None, loads global config
    """
    if config is None:
        from .config import get_config
        config = get_config()

    domain_keywords = config.domain_keywords
    task_lower = task.lower()
    best_domain = "general"
    best_score = 0

    for domain, keywords in domain_keywords.items():
        hits = sum(1 for kw in keywords if kw in task_lower)
        if hits > best_score:
            best_score = hits
            best_domain = domain

    return best_domain


def analyze_complexity(
    task: str,
    domain: str | None = None,
    config: object | None = None,
) -> ComplexityResult:
    """
    Analyze task complexity using heuristic signals.

    All signal tables and domain keywords come from config — nothing hardcoded.

    Args:
        task: The task description to analyze
        domain: Override domain detection
        config: Optional MMCPConfig — if None, loads global config

    Returns:
        ComplexityResult with classified tier, detected domain,
        confidence score, and human-readable reasoning.
    """
    if config is None:
        from .config import get_config
        config = get_config()

    if not domain:
        domain = detect_domain(task, config)

    # Load signals from config (not hardcoded)
    signals = config.complexity_signals
    frontier_signals = signals.get("frontier", [])
    complex_signals = signals.get("complex", [])
    standard_signals = signals.get("standard", [])
    trivial_signals = signals.get("trivial", [])

    # Count signal hits for each tier
    frontier_hits = _count_signal_hits(task, frontier_signals)
    complex_hits = _count_signal_hits(task, complex_signals)
    standard_hits = _count_signal_hits(task, standard_signals)
    trivial_hits = _count_signal_hits(task, trivial_signals)

    # Score each tier (weighted by number of hits)
    scores = {
        "frontier": len(frontier_hits) * 3.0,
        "complex": len(complex_hits) * 2.0,
        "standard": len(standard_hits) * 1.0,
        "trivial": len(trivial_hits) * 1.5,
    }

    # Adjust for reasoning depth
    reasoning_depth = _detect_reasoning_depth(task)
    if reasoning_depth >= 4:
        scores["frontier"] += 3.0
    elif reasoning_depth >= 3:
        scores["complex"] += 2.0
    elif reasoning_depth >= 2:
        scores["standard"] += 1.0

    # Adjust for estimated output length
    estimated_tokens = _estimate_output_tokens(task)
    if estimated_tokens > 2000:
        scores["complex"] += 1.5
    elif estimated_tokens < 100:
        scores["trivial"] += 1.0

    # Adjust for task length
    task_words = len(task.split())
    if task_words > 100:
        scores["complex"] += 1.0
    elif task_words < 10:
        scores["trivial"] += 0.5

    # Domain floor from config (not hardcoded)
    domain_floor_map = config.domain_complexity_floor
    domain_floor_str = domain_floor_map.get(domain)
    domain_floor = config.get_complexity_tier(domain_floor_str) if domain_floor_str else None

    # Determine winner
    tier_map = {
        "frontier": TaskComplexity.FRONTIER,
        "complex": TaskComplexity.COMPLEX,
        "standard": TaskComplexity.STANDARD,
        "trivial": TaskComplexity.TRIVIAL,
    }

    max_tier = max(scores, key=lambda k: scores[k])
    max_score = scores[max_tier]
    complexity = tier_map[max_tier]

    # Apply domain floor
    if domain_floor and _tier_rank(complexity) < _tier_rank(domain_floor):
        complexity = domain_floor
        max_tier = domain_floor.value

    # Calculate confidence
    total_score = sum(scores.values()) or 1.0
    confidence = min(max_score / total_score, 1.0) if total_score > 0 else 0.5

    # Default to STANDARD if no signals
    all_hits = frontier_hits + complex_hits + standard_hits + trivial_hits
    if not all_hits:
        complexity = TaskComplexity.STANDARD
        confidence = 0.3
        reasoning = "No strong signals detected — defaulting to standard complexity."
    else:
        reasoning = _build_reasoning(
            complexity, domain, all_hits, reasoning_depth, estimated_tokens
        )

    return ComplexityResult(
        complexity=complexity,
        domain=domain,
        confidence=round(confidence, 2),
        signals_found=all_hits,
        reasoning=reasoning,
        estimated_tokens=estimated_tokens,
        scores={k: round(v, 2) for k, v in scores.items()},
    )


def _tier_rank(tier: TaskComplexity) -> int:
    return {
        TaskComplexity.TRIVIAL: 0,
        TaskComplexity.STANDARD: 1,
        TaskComplexity.COMPLEX: 2,
        TaskComplexity.FRONTIER: 3,
    }[tier]


def _build_reasoning(
    complexity: TaskComplexity,
    domain: str,
    signals: list[str],
    depth: int,
    tokens: int,
) -> str:
    parts = [f"{complexity.value.upper()} complexity"]
    if domain != "general":
        parts.append(f"domain={domain}")
    if signals:
        parts.append(f"signals: {', '.join(signals[:3])}")
    if depth >= 3:
        parts.append(f"reasoning depth={depth}/5")
    if tokens > 1500:
        parts.append(f"est. {tokens} output tokens")
    return " | ".join(parts)
