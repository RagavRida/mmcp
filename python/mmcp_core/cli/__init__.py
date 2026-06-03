"""
MMCP CLI — command-line interface for the Multiple Model Context Protocol.

Usage:
    mmcp setup                               ← configure API keys (BYOK)
    mmcp login                               ← login to MMCP Cloud
    mmcp logout                              ← remove cloud credentials
    mmcp account                             ← view usage & billing
    mmcp run                                 ← interactive mode (smart routing)
    mmcp auto  "task"                        ← autonomous pipeline mode
    mmcp skills                              ← list saved pipeline skills
    mmcp cost                                ← spend summary & savings (v2.2)
    mmcp cost --savings                      ← cost reduction recommendations
    mmcp cost --budget 1.0                   ← set daily budget cap
    mmcp chain   "task" --roles architect,reviewer
    mmcp parallel "task" --fork-roles coder,analyst --merge-role summarizer
    mmcp verify  "task" --producer expert --challenger critic --synthesizer judge
    mmcp shard   "task" --role analyst --shards 3 --merge-role editor
    mmcp audit   path/to/audit.json
    mmcp version
"""
from __future__ import annotations
import argparse
import sys

from ..types import MMCP_VERSION
from ._common import _load_env, DIM, RED, RESET
from ..cloud import is_cloud_configured, DEFAULT_CLOUD_URL

# Import all command handlers
from .pipelines import cmd_chain, cmd_parallel, cmd_verify, cmd_shard
from .audit import cmd_audit
from .run import cmd_run
from .auto import cmd_auto, cmd_skills
from .cloud import cmd_login, cmd_logout, cmd_account, cmd_setup
from .cost import cmd_cost

import os


def cmd_version(_args: argparse.Namespace) -> None:
    """Print MMCP version info."""
    from .. import __version__
    print(f"mmcp-core  {__version__}")
    print(f"protocol   {MMCP_VERSION}")
    print(f"python     {sys.version.split()[0]}")


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

    # auto (v2 — autonomous pipeline)
    p_auto = sub.add_parser("auto", help="Autonomous mode — MMCP plans and executes")
    p_auto.add_argument("task", nargs="?", default=None, help="Task to execute")
    p_auto.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    p_auto.set_defaults(func=cmd_auto)

    # skills
    p_skills = sub.add_parser("skills", help="List saved pipeline skills")
    p_skills.set_defaults(func=cmd_skills)

    # login
    p_login = sub.add_parser("login", help="Login to MMCP Cloud")
    p_login.add_argument("--url", default=DEFAULT_CLOUD_URL,
                         help=f"Cloud API URL (default: {DEFAULT_CLOUD_URL})")
    p_login.set_defaults(func=cmd_login)

    # logout
    p_logout = sub.add_parser("logout", help="Remove MMCP Cloud credentials")
    p_logout.set_defaults(func=cmd_logout)

    # account
    p_account = sub.add_parser("account", help="View usage & billing")
    p_account.set_defaults(func=cmd_account)

    # setup
    p_setup = sub.add_parser("setup", help="Interactive setup wizard (BYOK mode)")
    p_setup.set_defaults(func=cmd_setup)

    # cost (v2.2 — expense tracking)
    p_cost = sub.add_parser("cost", help="Spend summary, savings & budget (v2.2)")
    p_cost.add_argument("cost_action", nargs="?", default=None,
                        choices=["savings", "budget", "report", "mcp"],
                        help="Subcommand: savings, budget, report, mcp")
    p_cost.add_argument("budget_value", nargs="?", type=float, default=None,
                        help="Budget amount in USD (for 'budget' action)")
    p_cost.set_defaults(func=cmd_cost)

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

        if is_cloud_configured() and not use_or:
            pass
        elif use_or:
            if not os.environ.get("OPENROUTER_API_KEY"):
                print(f"{RED}Error: OPENROUTER_API_KEY not set{RESET}")
                print(f"{DIM}  export OPENROUTER_API_KEY=sk-or-...{RESET}")
                sys.exit(1)
        else:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                if is_cloud_configured():
                    pass
                else:
                    print(f"{RED}Error: No API key configured{RESET}")
                    print(f"{DIM}  Option 1: mmcp login        (MMCP Cloud){RESET}")
                    print(f"{DIM}  Option 2: mmcp setup        (Bring Your Own Key){RESET}")
                    print(f"{DIM}  Option 3: --openrouter flag  (with OPENROUTER_API_KEY){RESET}")
                    sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
