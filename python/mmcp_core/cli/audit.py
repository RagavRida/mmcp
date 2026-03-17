"""Audit trail viewer command."""
from __future__ import annotations
import argparse
import json
import os
import sys

from ._common import (
    _banner, _status_icon, BOLD, DIM, RED, RESET,
)


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
