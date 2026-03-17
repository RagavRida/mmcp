"""Pipeline commands: chain, parallel, verify, shard."""
from __future__ import annotations
import argparse
import asyncio
import sys

from ._common import (
    _resolve_model, _banner, _print_result, _maybe_export,
    _make_orchestrator, RED, RESET,
)


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
        print("  Via:    OpenRouter")

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
        print("  Via:        OpenRouter")

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
        print("  Via:         OpenRouter")

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
        print("  Via:        OpenRouter")

    roles = [args.role, args.merge_role]
    orc = _make_orchestrator(roles, model, args.verbose, use_or)
    result = asyncio.run(orc.run_sharded(
        args.task, args.role, args.shards, args.merge_role,
    ))
    _print_result(result, args.verbose)
    _maybe_export(result, orc, args)
