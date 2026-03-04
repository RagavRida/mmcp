"""
MMCP CLI — command-line interface for the Multiple Model Context Protocol.

Usage:
    mmcp setup                               ← configure API keys
    mmcp chain   "task" --roles architect,reviewer
    mmcp parallel "task" --fork-roles coder,analyst --merge-role summarizer
    mmcp verify  "task" --producer expert --challenger critic --synthesizer judge
    mmcp shard   "task" --role analyst --shards 3 --merge-role editor
    mmcp audit   path/to/audit.json
    mmcp version
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from .types import MMCP_VERSION
from .orchestrator import MMCPOrchestrator
from .router import RoleBasedRouter
from .store import MemoryStore
from .shared import SharedContextStore
from .observer import MMCPObserver
from .wire import MMCPWireFormat
from .adapter import call_openrouter

# OpenRouter uses different model IDs than Anthropic direct
OPENROUTER_MODEL_MAP: dict[str, str] = {
    "claude-haiku-4-5-20251001": "anthropic/claude-3.5-haiku",
    "claude-sonnet-4-20250514":  "anthropic/claude-sonnet-4",
    "claude-opus-4-20250514":    "anthropic/claude-opus-4",
}
OPENROUTER_DEFAULT_MODEL = "anthropic/claude-3.5-haiku"


def _resolve_model(model: str, use_openrouter: bool) -> str:
    """Map Anthropic model IDs to OpenRouter format if needed."""
    if not use_openrouter:
        return model
    if model in OPENROUTER_MODEL_MAP:
        return OPENROUTER_MODEL_MAP[model]
    if "/" in model:  # already in vendor/model format
        return model
    return f"anthropic/{model}"


# ── Formatting helpers ──────────────────────────────────────────────────────

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
BLUE = "\033[34m"


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


# ── Commands ────────────────────────────────────────────────────────────────

def cmd_chain(args: argparse.Namespace) -> None:
    """Run a sequential handoff chain."""
    roles = [r.strip() for r in args.roles.split(",")]
    if len(roles) < 2:
        print(f"{RED}Error: chain requires at least 2 roles (got {len(roles)}){RESET}")
        sys.exit(1)

    use_or = getattr(args, 'openrouter', False)
    model = _resolve_model(args.model, use_or)

    _banner(f"Chain: {' → '.join(roles)}")
    print(f"  Task:   {args.task}")
    print(f"  Model:  {model}")
    print(f"  Roles:  {' → '.join(roles)}")
    if use_or:
        print(f"  Via:    OpenRouter")

    orc = _make_orchestrator(roles, model, args.verbose, use_or)
    result = asyncio.run(orc.run_chain(args.task, roles))
    _print_result(result, args.verbose)
    _maybe_export(result, orc, args)


def cmd_parallel(args: argparse.Namespace) -> None:
    """Run a fork → merge parallel pipeline."""
    fork_roles = [r.strip() for r in args.fork_roles.split(",")]
    merge_role = args.merge_role

    use_or = getattr(args, 'openrouter', False)
    model = _resolve_model(args.model, use_or)

    _banner(f"Parallel: [{', '.join(fork_roles)}] → {merge_role}")
    print(f"  Task:       {args.task}")
    print(f"  Model:      {model}")
    print(f"  Fork roles: {', '.join(fork_roles)}")
    print(f"  Merge role: {merge_role}")
    if use_or:
        print(f"  Via:        OpenRouter")

    all_roles = fork_roles + [merge_role]
    orc = _make_orchestrator(all_roles, model, args.verbose, use_or)
    result = asyncio.run(orc.run_parallel(args.task, fork_roles, merge_role))
    _print_result(result, args.verbose)
    _maybe_export(result, orc, args)


def cmd_verify(args: argparse.Namespace) -> None:
    """Run producer → challenger → synthesizer verification."""
    use_or = getattr(args, 'openrouter', False)
    model = _resolve_model(args.model, use_or)

    _banner(f"Verify: {args.producer} → {args.challenger} → {args.synthesizer}")
    print(f"  Task:        {args.task}")
    print(f"  Model:       {model}")
    print(f"  Producer:    {args.producer}")
    print(f"  Challenger:  {args.challenger}")
    print(f"  Synthesizer: {args.synthesizer}")
    if use_or:
        print(f"  Via:         OpenRouter")

    roles = [args.producer, args.challenger, args.synthesizer]
    orc = _make_orchestrator(roles, model, args.verbose, use_or)
    result = asyncio.run(orc.run_verify(
        args.task, args.producer, args.challenger, args.synthesizer,
    ))
    _print_result(result, args.verbose)
    _maybe_export(result, orc, args)


def cmd_shard(args: argparse.Namespace) -> None:
    """Run sharded pipeline: split → N shards → merge."""
    use_or = getattr(args, 'openrouter', False)
    model = _resolve_model(args.model, use_or)

    _banner(f"Shard: {args.role} ×{args.shards} → {args.merge_role}")
    print(f"  Task:       {args.task}")
    print(f"  Model:      {model}")
    print(f"  Shard role: {args.role}")
    print(f"  Shards:     {args.shards}")
    print(f"  Merge role: {args.merge_role}")
    if use_or:
        print(f"  Via:        OpenRouter")

    roles = [args.role, args.merge_role]
    orc = _make_orchestrator(roles, model, args.verbose, use_or)
    result = asyncio.run(orc.run_sharded(
        args.task, args.role, args.shards, args.merge_role,
    ))
    _print_result(result, args.verbose)
    _maybe_export(result, orc, args)


def cmd_audit(args: argparse.Namespace) -> None:
    """View and validate an MMCP audit trail JSON file."""
    path = args.file
    if not os.path.exists(path):
        print(f"{RED}Error: file not found: {path}{RESET}")
        sys.exit(1)

    with open(path) as f:
        data = json.load(f)

    _banner("Audit Trail Viewer")
    print(f"  File: {path}")
    print(f"  MMCP: {data.get('mmcp', '?')}")
    print(f"  DAG ID: {data.get('dag_id', '?')}")
    print(f"  Created: {data.get('created_at', '?')}")

    envelopes = data.get("envelopes", [])
    print(f"\n{BOLD}Envelopes ({len(envelopes)}):{RESET}")
    for e in envelopes:
        status = e.get("status", "?")
        icon = _status_icon(status)
        role = e.get("role", "?")
        model = e.get("model", "?")
        tokens = e.get("tokens_used")
        cost = e.get("cost_usd")
        branch = e.get("branch_type", "?")
        depth = e.get("depth", 0)
        indent = "  " * depth
        tok_str = f" [{tokens}t]" if tokens else ""
        cost_str = f" ${cost:.6f}" if cost else ""
        audit_hash = e.get("compliance", {}).get("audit_hash", "")[:16]
        print(f"  {indent}{icon} {DIM}[{branch}]{RESET} {BOLD}{role}{RESET} "
              f"({model}){tok_str}{cost_str} {DIM}#{audit_hash}{RESET}")

    report = data.get("compliance_report", {})
    tags = data.get("regulation_tags", [])
    total_tokens = data.get("total_tokens", 0)
    total_cost = data.get("total_cost_usd", 0)

    print(f"\n{BOLD}Summary:{RESET}")
    print(f"  Nodes:       {report.get('total_nodes', len(envelopes))}")
    print(f"  Tokens:      {total_tokens:,}")
    print(f"  Cost:        ${total_cost:.6f}")
    print(f"  Valid:       {'✅' if report.get('valid') else '❌'}")
    print(f"  Regulations: {', '.join(tags) if tags else 'none'}")

    verified = report.get("verified_nodes", [])
    if verified:
        print(f"  Verified:    {len(verified)} node(s)")

    chain = report.get("audit_chain", [])
    if chain and args.verbose:
        print(f"\n{BOLD}Audit Chain:{RESET}")
        for entry in chain:
            seq = entry.get("sequence", "?")
            role = entry.get("role", "?")
            h = entry.get("audit_hash", "")[:16]
            preview = entry.get("output_preview", "")[:60]
            print(f"  [{seq}] {role} — {DIM}#{h}…{RESET} {preview}")


def cmd_run(_args: argparse.Namespace) -> None:
    """Interactive prompt-based mode for non-developers."""
    _load_env()
    _banner("Interactive Mode")
    print(f"  {DIM}Answer the prompts below. Press Ctrl+C to cancel.{RESET}\n")

    # ── 1. What should the AI do? ──────────────────────────────────────
    print(f"{BOLD}📝 What should the AI do?{RESET}")
    print(f"  {DIM}Examples: 'Write a blog post about AI', 'Analyze pros and cons of remote work'{RESET}")
    task = input(f"\n  {BOLD}Your task:{RESET} ").strip()
    if not task:
        print(f"{RED}No task provided. Exiting.{RESET}")
        return

    # ── 2. Choose a pattern ────────────────────────────────────────────
    print(f"\n{BOLD}🔀 How should the AI work on this?{RESET}")
    print(f"  {CYAN}1{RESET}  ✍️  Simple      {DIM}— One expert writes, another reviews{RESET}")
    print(f"  {CYAN}2{RESET}  🔀 Multi-view   {DIM}— Multiple experts work in parallel, then combine{RESET}")
    print(f"  {CYAN}3{RESET}  ⚖️  Debate       {DIM}— One writes, one challenges, one gives final answer{RESET}")
    print(f"  {CYAN}4{RESET}  📊 Deep dive    {DIM}— Split into parts, analyze each, merge results{RESET}")

    pattern = input(f"\n  {BOLD}Choose [1-4]:{RESET} ").strip() or "1"

    # ── 3. Optional: customize roles ───────────────────────────────────
    print(f"\n{BOLD}🎭 Want to name the AI agents?{RESET} {DIM}(press Enter to use defaults){RESET}")

    if pattern == "1":
        default_a, default_b = "writer", "reviewer"
        role1 = input(f"  Agent 1 [{default_a}]: ").strip() or default_a
        role2 = input(f"  Agent 2 [{default_b}]: ").strip() or default_b
        roles_display = f"{role1} → {role2}"
        pipeline_type = "chain"

    elif pattern == "2":
        default_roles = "analyst,creative,critic"
        merge_default = "synthesizer"
        roles_str = input(f"  Parallel agents [{default_roles}]: ").strip() or default_roles
        merge_role = input(f"  Merge agent   [{merge_default}]: ").strip() or merge_default
        fork_roles = [r.strip() for r in roles_str.split(",")]
        roles_display = f"[{', '.join(fork_roles)}] → {merge_role}"
        pipeline_type = "parallel"

    elif pattern == "3":
        default_p, default_c, default_s = "expert", "challenger", "synthesizer"
        role_p = input(f"  Producer    [{default_p}]: ").strip() or default_p
        role_c = input(f"  Challenger  [{default_c}]: ").strip() or default_c
        role_s = input(f"  Synthesizer [{default_s}]: ").strip() or default_s
        roles_display = f"{role_p} → {role_c} → {role_s}"
        pipeline_type = "verify"

    elif pattern == "4":
        default_role = "analyst"
        merge_default = "editor"
        shard_role = input(f"  Shard agent [{default_role}]: ").strip() or default_role
        n_str = input(f"  How many parts? [3]: ").strip() or "3"
        n = int(n_str) if n_str.isdigit() else 3
        merge_role = input(f"  Merge agent [{merge_default}]: ").strip() or merge_default
        roles_display = f"{shard_role} ×{n} → {merge_role}"
        pipeline_type = "shard"
    else:
        print(f"{RED}Invalid choice. Using Simple mode.{RESET}")
        role1, role2 = "writer", "reviewer"
        roles_display = f"{role1} → {role2}"
        pipeline_type = "chain"

    # ── 4. Choose model ────────────────────────────────────────────────
    print(f"\n{BOLD}🤖 Choose AI model:{RESET}")
    print(f"  {CYAN}1{RESET}  Haiku     {DIM}— Fast & cheap (recommended){RESET}")
    print(f"  {CYAN}2{RESET}  Sonnet    {DIM}— Balanced quality & speed{RESET}")
    print(f"  {CYAN}3{RESET}  Opus      {DIM}— Most capable, slower{RESET}")

    model_choice = input(f"\n  {BOLD}Choose [1-3]:{RESET} ").strip() or "1"
    model_map_or = {"1": "anthropic/claude-3.5-haiku", "2": "anthropic/claude-sonnet-4", "3": "anthropic/claude-opus-4"}
    model_map_an = {"1": "claude-haiku-4-5-20251001", "2": "claude-sonnet-4-20250514", "3": "claude-opus-4-20250514"}

    # ── 5. Detect provider ─────────────────────────────────────────────
    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    an_key = os.environ.get("ANTHROPIC_API_KEY", "")
    use_or = bool(or_key)

    if not or_key and not an_key:
        print(f"\n{RED}No API key found! Run 'mmcp setup' first.{RESET}")
        return

    model = model_map_or.get(model_choice, model_map_or["1"]) if use_or else model_map_an.get(model_choice, model_map_an["1"])
    provider = "OpenRouter" if use_or else "Anthropic"

    # ── 6. Export option ───────────────────────────────────────────────
    save = input(f"\n{BOLD}💾 Save audit trail? [y/N]:{RESET} ").strip().lower()
    export_path = None
    if save in ("y", "yes"):
        export_path = f"./mmcp-audits/run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    # ── 7. Confirm and run ─────────────────────────────────────────────
    print(f"\n{'─' * 60}")
    print(f"  {BOLD}Task:{RESET}     {task}")
    print(f"  {BOLD}Pattern:{RESET}  {roles_display}")
    print(f"  {BOLD}Model:{RESET}    {model.split('/')[-1]}")
    print(f"  {BOLD}Via:{RESET}      {provider}")
    if export_path:
        print(f"  {BOLD}Export:{RESET}   {export_path}")
    print(f"{'─' * 60}")

    go = input(f"\n  {BOLD}Run? [Y/n]:{RESET} ").strip().lower()
    if go in ("n", "no"):
        print(f"{DIM}Cancelled.{RESET}")
        return

    # ── 8. Build and execute ───────────────────────────────────────────
    print(f"\n{BOLD}🚀 Running...{RESET}\n")

    if pipeline_type == "chain":
        all_roles = [role1, role2]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_chain(task, all_roles))

    elif pipeline_type == "parallel":
        all_roles = fork_roles + [merge_role]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_parallel(task, fork_roles, merge_role))

    elif pipeline_type == "verify":
        all_roles = [role_p, role_c, role_s]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_verify(task, role_p, role_c, role_s))

    elif pipeline_type == "shard":
        all_roles = [shard_role, merge_role]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_sharded(task, shard_role, n, merge_role))

    # ── 9. Show results ───────────────────────────────────────────────
    _print_result(result, verbose=False)

    if export_path and result:
        fmt = MMCPWireFormat()
        wire_dag = fmt.serialize_dag(result.dag)
        os.makedirs(os.path.dirname(export_path) or ".", exist_ok=True)
        with open(export_path, "w") as f:
            json.dump(wire_dag, f, indent=2, default=str)
        print(f"\n{GREEN}📄 Audit trail saved: {export_path}{RESET}")

    # ── 10. Ask to continue ───────────────────────────────────────────
    print()
    again = input(f"  {BOLD}Run another task? [y/N]:{RESET} ").strip().lower()
    if again in ("y", "yes"):
        cmd_run(_args)


def cmd_setup(_args: argparse.Namespace) -> None:
    """Interactive setup wizard for MMCP."""
    _banner("Setup Wizard")
    _load_env()

    # ── Detect existing config ──────────────────────────────────────────
    env_file = _find_env_file()
    existing: dict[str, str] = {}
    if env_file:
        print(f"  {GREEN}Found .env:{RESET} {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    existing[k.strip()] = v.strip()
    else:
        print(f"  {YELLOW}No .env file found{RESET}")
        env_file = os.path.join(os.getcwd(), ".env")

    # Show current status
    or_key = existing.get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY", "")
    an_key = existing.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    print(f"\n{BOLD}Current API Keys:{RESET}")
    print(f"  OPENROUTER_API_KEY:  {_mask_key(or_key) if or_key else f'{RED}not set{RESET}'}")
    print(f"  ANTHROPIC_API_KEY:   {_mask_key(an_key) if an_key else f'{YELLOW}not set{RESET}'}")

    # ── Provider selection ───────────────────────────────────────────────
    print(f"\n{BOLD}Choose your API provider:{RESET}")
    print(f"  {CYAN}1{RESET}  OpenRouter  {DIM}(recommended — multi-model, one key){RESET}")
    print(f"  {CYAN}2{RESET}  Anthropic   {DIM}(direct API access){RESET}")
    print(f"  {CYAN}3{RESET}  Both")
    print(f"  {CYAN}4{RESET}  Skip        {DIM}(keep current config){RESET}")

    choice = input(f"\n  {BOLD}Select [1-4]:{RESET} ").strip()

    updated = dict(existing)

    if choice in ("1", "3"):
        print(f"\n  Get your key at: {CYAN}https://openrouter.ai/keys{RESET}")
        new_key = input(f"  {BOLD}OPENROUTER_API_KEY{RESET} [{_mask_key(or_key) if or_key else 'none'}]: ").strip()
        if new_key:
            updated["OPENROUTER_API_KEY"] = new_key
            or_key = new_key

    if choice in ("2", "3"):
        print(f"\n  Get your key at: {CYAN}https://console.anthropic.com/settings/keys{RESET}")
        new_key = input(f"  {BOLD}ANTHROPIC_API_KEY{RESET} [{_mask_key(an_key) if an_key else 'none'}]: ").strip()
        if new_key:
            updated["ANTHROPIC_API_KEY"] = new_key
            an_key = new_key

    # ── Write .env ──────────────────────────────────────────────────────
    if updated != existing and choice != "4":
        _write_env_file(env_file, updated)
        print(f"\n  {GREEN}✓ Saved to {env_file}{RESET}")
        # reload
        for k, v in updated.items():
            os.environ[k] = v
    elif choice == "4":
        print(f"\n  {DIM}Skipped — keeping current config{RESET}")

    # ── Test connection ─────────────────────────────────────────────────
    test_key = or_key or an_key
    if not test_key:
        print(f"\n  {YELLOW}⚠ No API key configured. Run 'mmcp setup' again to add one.{RESET}")
        return

    print(f"\n{BOLD}Testing connection...{RESET}")
    use_or = bool(or_key)
    provider = "OpenRouter" if use_or else "Anthropic"
    model = "anthropic/claude-3.5-haiku" if use_or else "claude-haiku-4-5-20251001"

    try:
        import httpx
        result = asyncio.run(_test_connection(use_or, model))
        print(f"  {GREEN}✓ {provider} connection OK{RESET}")
        print(f"  Model:  {result.get('model', model)}")
        print(f"  Output: {result.get('output', '')[:80]}")
        print(f"  Tokens: {result.get('tokens_used', 0)}")
    except Exception as e:
        print(f"  {RED}✗ {provider} connection failed: {e}{RESET}")
        print(f"  {DIM}Check your API key and try again.{RESET}")
        return

    # ── Done ────────────────────────────────────────────────────────────
    print(f"\n{GREEN}{'═' * 60}{RESET}")
    print(f"{GREEN}  ✅ MMCP is ready!{RESET}")
    print(f"{GREEN}{'═' * 60}{RESET}")
    flag = " --openrouter" if use_or else ""
    print(f"\n  Try: {CYAN}mmcp chain \"Explain DAGs\" -r architect,reviewer{flag}{RESET}")
    print()


async def _test_connection(use_openrouter: bool, model: str) -> dict:
    """Quick test call to verify API key works."""
    from .adapter import call_openrouter, call_anthropic
    from .types import ModelAssignment
    from .context import create_context

    ctx = create_context(task="Say hello in exactly one word.", role="test", model=model)
    assignment = ModelAssignment(
        model_id=model,
        endpoint="",
        system_prompt="Respond in exactly one word.",
        max_tokens=20,
    )
    if use_openrouter:
        return await call_openrouter(assignment, ctx)
    else:
        return await call_anthropic(assignment, ctx)


def _find_env_file() -> str | None:
    """Find .env file in cwd or parent dirs."""
    for d in [os.getcwd(), os.path.join(os.getcwd(), "..")]:
        p = os.path.join(d, ".env")
        if os.path.exists(p):
            return p
    return None


def _write_env_file(path: str, entries: dict[str, str]) -> None:
    """Write entries to .env file, preserving comments and unknown keys."""
    lines: list[str] = []
    existing_keys: set[str] = set()

    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.partition("=")[0].strip()
                    if key in entries:
                        lines.append(f"{key}={entries[key]}\n")
                        existing_keys.add(key)
                        continue
                lines.append(line)

    # Add new keys not in original file
    for key, val in entries.items():
        if key not in existing_keys:
            lines.append(f"{key}={val}\n")

    with open(path, "w") as f:
        f.writelines(lines)


def _mask_key(key: str) -> str:
    """Mask an API key for display: sk-or-v1-8c6...1ce"""
    if len(key) <= 12:
        return "***"
    return f"{key[:10]}...{key[-3:]}"


def cmd_version(_args: argparse.Namespace) -> None:
    """Print MMCP version info."""
    from . import __version__
    print(f"mmcp-core  {__version__}")
    print(f"protocol   {MMCP_VERSION}")
    print(f"python     {sys.version.split()[0]}")


# ── Export helper ───────────────────────────────────────────────────────────

def _maybe_export(result, orc: MMCPOrchestrator, args: argparse.Namespace) -> None:
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


# ── Parser ──────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mmcp",
        description="MMCP — Multiple Model Context Protocol CLI",
        epilog="Set ANTHROPIC_API_KEY env var before running pipelines.",
    )
    parser.add_argument("--version", action="store_true", help="Show version")

    sub = parser.add_subparsers(dest="command", help="Available commands")

    # Shared arguments
    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("task", help="The task / prompt to execute")
        p.add_argument("-m", "--model", default="claude-haiku-4-5-20251001",
                       help="Model ID (default: claude-haiku-4-5-20251001)")
        p.add_argument("-v", "--verbose", action="store_true",
                       help="Show full output and event logs")
        p.add_argument("--openrouter", action="store_true",
                       help="Use OpenRouter API instead of Anthropic direct")
        p.add_argument("-e", "--export", metavar="FILE",
                       help="Export WireDAG audit trail to JSON file")
        p.add_argument("-t", "--tags", metavar="TAGS",
                       help="Comma-separated regulation tags (e.g. SOC2,GDPR)")

    # chain
    p_chain = sub.add_parser("chain", help="Sequential handoff chain")
    add_common(p_chain)
    p_chain.add_argument("-r", "--roles", required=True,
                         help="Comma-separated roles (e.g. architect,coder,reviewer)")
    p_chain.set_defaults(func=cmd_chain)

    # parallel
    p_par = sub.add_parser("parallel", help="Fork → merge parallel pipeline")
    add_common(p_par)
    p_par.add_argument("-f", "--fork-roles", required=True,
                       help="Comma-separated fork roles (e.g. coder,analyst)")
    p_par.add_argument("-M", "--merge-role", required=True,
                       help="Merge role (e.g. summarizer)")
    p_par.set_defaults(func=cmd_parallel)

    # verify
    p_ver = sub.add_parser("verify", help="Producer → challenger → synthesizer")
    add_common(p_ver)
    p_ver.add_argument("-p", "--producer", required=True, help="Producer role")
    p_ver.add_argument("-c", "--challenger", required=True, help="Challenger role")
    p_ver.add_argument("-s", "--synthesizer", required=True, help="Synthesizer role")
    p_ver.set_defaults(func=cmd_verify)

    # shard
    p_shard = sub.add_parser("shard", help="Split → N shards → merge")
    add_common(p_shard)
    p_shard.add_argument("-r", "--role", required=True, help="Shard role")
    p_shard.add_argument("-n", "--shards", type=int, required=True,
                         help="Number of shards")
    p_shard.add_argument("-M", "--merge-role", required=True,
                         help="Merge role")
    p_shard.set_defaults(func=cmd_shard)

    # audit
    p_audit = sub.add_parser("audit", help="View an MMCP audit trail JSON")
    p_audit.add_argument("file", help="Path to audit JSON file")
    p_audit.add_argument("-v", "--verbose", action="store_true",
                         help="Show full audit chain")
    p_audit.set_defaults(func=cmd_audit)

    # run (interactive)
    p_run = sub.add_parser("run", help="Interactive mode (no CLI knowledge needed)")
    p_run.set_defaults(func=cmd_run)

    # setup
    p_setup = sub.add_parser("setup", help="Interactive setup wizard")
    p_setup.set_defaults(func=cmd_setup)

    # version
    p_ver_cmd = sub.add_parser("version", help="Show version info")
    p_ver_cmd.set_defaults(func=cmd_version)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.version:
        cmd_version(args)
        return

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # Load .env file
    _load_env()

    # Check API key for pipeline commands
    if args.command in ("chain", "parallel", "verify", "shard"):
        use_or = getattr(args, 'openrouter', False)
        if use_or:
            if not os.environ.get("OPENROUTER_API_KEY"):
                print(f"{RED}Error: OPENROUTER_API_KEY not set{RESET}")
                print(f"{DIM}  export OPENROUTER_API_KEY=sk-or-...{RESET}")
                sys.exit(1)
        else:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                print(f"{RED}Error: ANTHROPIC_API_KEY not set{RESET}")
                print(f"{DIM}  export ANTHROPIC_API_KEY=sk-ant-...{RESET}")
                print(f"{DIM}  Or use --openrouter with OPENROUTER_API_KEY{RESET}")
                sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
