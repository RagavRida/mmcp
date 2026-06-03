# MMCP Smart Routing Reference

## How Routing Works

```
Task → ComplexityAnalyzer → SmartRouter → Model + Justification
           │                    │
     Heuristic signals    RL feedback loop
     Domain detection     Budget constraints
     Output estimation    Domain preferences
```

## Complexity Tiers

| Tier | Examples | Default Models | Cost |
|---|---|---|---|
| **TRIVIAL** | translate, format, rename, count | llama-4-maverick, haiku | ~$0.0001 |
| **STANDARD** | write blog, summarize, draft email | haiku, gemini-flash | ~$0.001 |
| **COMPLEX** | implement API, code review, debug | sonnet, gemini-pro | ~$0.005 |
| **FRONTIER** | prove theorem, security audit, system design | deepseek-r1, opus | ~$0.01+ |

## Complexity Signals

The analyzer uses keyword signals to classify tasks. All signals come from config:

```python
# From config.complexity_signals
"frontier": ["prove", "theorem", "security audit", "system design", "research paper", ...]
"complex":  ["implement", "build", "debug", "refactor", "code review", ...]
"standard": ["write", "draft", "summarize", "convert", "explain", ...]
"trivial":  ["translate", "fix typo", "format", "rename", "count", ...]
```

Additional factors:
- **Reasoning depth**: Multi-step, if-then, edge cases → higher tier
- **Output length**: >2000 tokens → bumps to COMPLEX
- **Task length**: <10 words → TRIVIAL bias, >100 words → COMPLEX bias
- **Domain floor**: Math, security always ≥ COMPLEX

## Domain Detection

Domains detected from keyword overlap:
- `code_generation`, `code_review`, `math_reasoning`, `creative_writing`
- `analysis`, `planning`, `summarization`, `security`
- `general` (fallback)

Each domain can have preferred models per tier (from config):
```yaml
domain_preferences:
  math_reasoning: { complex: deepseek/deepseek-r1, frontier: deepseek/deepseek-r1 }
  code_generation: { complex: anthropic/claude-sonnet-4 }
```

## RL Feedback Loop

The SmartRouter uses **UCB1 + epsilon-greedy** to learn which models work best:

1. **Cold start** (first 5 invocations): Use default model for the tier
2. **Explore** (epsilon chance): Try a random candidate model
3. **Exploit** (1-epsilon): Pick model with highest UCB1 score

Score formula:
```
score = accuracy_weight × success_rate
      - latency_weight × normalized_latency
      - cost_weight × normalized_cost

UCB1 = score + c × sqrt(ln(total_invocations) / model_runs)
```

After each call, `record_outcome()` updates stats. Epsilon decays over time.

## Model Justification

Every model selection includes a `ModelJustification`:

```python
@dataclass
class ModelJustification:
    task_complexity: TaskComplexity
    chosen_model: str
    domain: str
    reasoning: str                 # Human-readable explanation
    estimated_cost: float
    alternative_model: str         # Cheapest alternative
    alternative_cost: float
    savings_percent: float         # % saved if using alternative
    quality_risk: str              # Risk assessment of downgrading
```

## Budget Constraints

When `daily_budget_usd` is set:
- If remaining budget < 50% of estimated cost → auto-downgrade to cheapest candidate
- If budget exhausted → force TRIVIAL tier for all tasks
- Budget status available via `SmartRouter.get_budget_status()`

## Python API

```python
from mmcp_core import SmartRouter, analyze_complexity

# Analyze complexity
result = analyze_complexity("prove the Riemann hypothesis")
# → ComplexityResult(complexity=FRONTIER, domain="math_reasoning", confidence=0.86)

# Route to model
router = SmartRouter()
decision = router.route("prove the Riemann hypothesis")
# → SmartRouteDecision(model="deepseek/deepseek-r1", complexity=FRONTIER)
print(decision.justification.reasoning)
# → "FRONTIER task in math_reasoning domain | signals: prove, theorem | premium model justified"

# Record outcome (RL feedback)
router.record_outcome(
    model="deepseek/deepseek-r1",
    domain="math_reasoning",
    success=True,
    latency_ms=5000,
    cost_usd=0.003,
)

# Get rankings
rankings = router.get_rankings(domain="math_reasoning")
```
