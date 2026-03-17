"""
Shared utilities for the MMCP CLI.

Colors, banners, formatters, orchestrator factory, env loading.
"""
from __future__ import annotations
import json
import os

from ..orchestrator import MMCPOrchestrator
from ..router import RoleBasedRouter
from ..store import MemoryStore
from ..shared import SharedContextStore
from ..observer import MMCPObserver
from ..wire import MMCPWireFormat
from ..adapter import call_openrouter

# ── ANSI Colors ─────────────────────────────────────────────────────────────

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
BLUE = "\033[34m"

# ── OpenRouter model map ────────────────────────────────────────────────────

OPENROUTER_MODEL_MAP: dict[str, str] = {
    "claude-haiku-4-5-20251001": "anthropic/claude-3.5-haiku",
    "claude-sonnet-4-20250514":  "anthropic/claude-sonnet-4",
    "claude-opus-4-20250514":    "anthropic/claude-opus-4",
}
OPENROUTER_DEFAULT_MODEL = "anthropic/claude-3.5-haiku"


# ── Helper functions ────────────────────────────────────────────────────────

def _resolve_model(model: str, use_openrouter: bool) -> str:
    """Map Anthropic model IDs to OpenRouter format if needed."""
    if not use_openrouter:
        return model
    if model in OPENROUTER_MODEL_MAP:
        return OPENROUTER_MODEL_MAP[model]
    if "/" in model:
        return model
    return f"anthropic/{model}"


def _banner(title: str) -> None:
    w = 60
    print(f"\n{CYAN}{'═' * w}{RESET}")
    print(f"{BOLD}{CYAN}  MMCP  {RESET}{BOLD}{title}{RESET}")
    print(f"{CYAN}{'═' * w}{RESET}")


def _status_icon(status: str) -> str:
    return {"done": f"{GREEN}✓{RESET}", "failed": f"{RED}✗{RESET}",
            "skipped": f"{YELLOW}–{RESET}", "running": f"{YELLOW}⟳{RESET}",
            "pending": f"{DIM}○{RESET}"}.get(status, "?")


def _print_result(result, verbose: bool = False) -> None:
    print(f"\n{BOLD}Result:{RESET}")
    print(f"  Status:    {'✅ SUCCESS' if result.success else '❌ FAILED'}")
    print(f"  Nodes:     {result.total_nodes}")
    print(f"  Tokens:    {result.total_tokens:,}")
    print(f"  Cost:      ${result.total_cost_usd:.6f}")
    print(f"  Duration:  {result.duration_ms}ms")

    if result.failed_nodes:
        print(f"  {RED}Failed:    {len(result.failed_nodes)} nodes{RESET}")
    if result.skipped_nodes:
        print(f"  {YELLOW}Skipped:   {len(result.skipped_nodes)} nodes{RESET}")

    print(f"\n{BOLD}DAG:{RESET}")
    for ctx in result.dag:
        icon = _status_icon(ctx.status)
        tokens = f" [{ctx.tokens_used}t]" if ctx.tokens_used else ""
        cost = f" ${ctx.cost_usd:.6f}" if ctx.cost_usd else ""
        model_short = ctx.model.split("/")[-1] if ctx.model else ""
        indent = "  " * ctx.depth
        branch = f"{DIM}[{ctx.branch_type}]{RESET}"
        print(f"  {indent}{icon} {branch} {BOLD}{ctx.role}{RESET} "
              f"({model_short}){tokens}{cost}")

    print(f"\n{BOLD}Output:{RESET}")
    output = result.output
    if not verbose and len(output) > 800:
        output = output[:800] + f"\n{DIM}... (truncated, use --verbose for full){RESET}"
    print(output)


def _load_env() -> None:
    """Load .env file from cwd or parent dirs."""
    for d in [os.getcwd(), os.path.join(os.getcwd(), "..")]:
        env_file = os.path.join(d, ".env")
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        os.environ.setdefault(key.strip(), value.strip())
            break


def _make_orchestrator(
    roles: list[str],
    model: str,
    verbose: bool = False,
    use_openrouter: bool = False,
) -> MMCPOrchestrator:
    observer = MMCPObserver()
    if verbose:
        observer.enable_console_logging()

    router_config = {role: {"model_id": model} for role in roles}
    router_config["orchestrator"] = {"model_id": model}

    config: dict = {
        "router": RoleBasedRouter(router_config),
        "store": MemoryStore(),
        "shared": SharedContextStore(),
        "observer": observer,
    }
    if use_openrouter:
        config["adapter"] = call_openrouter

    return MMCPOrchestrator(config)


def _maybe_export(result, orc: MMCPOrchestrator, args) -> None:
    export_path = getattr(args, "export", None)
    if not export_path:
        return

    fmt = MMCPWireFormat()
    wire_dag = fmt.serialize_dag(
        result.dag,
        regulation_tags=getattr(args, "tags", "").split(",") if getattr(args, "tags", None) else [],
    )

    os.makedirs(os.path.dirname(export_path) or ".", exist_ok=True)
    with open(export_path, "w") as f:
        json.dump(wire_dag, f, indent=2, default=str)
    print(f"\n{GREEN}📄 Audit trail exported: {export_path}{RESET}")


def _mask_key(key: str) -> str:
    """Mask an API key for display: sk-or-v1-8c6...1ce"""
    if len(key) <= 12:
        return "***"
    return f"{key[:10]}...{key[-3:]}"
