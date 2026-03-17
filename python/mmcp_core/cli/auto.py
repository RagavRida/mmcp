"""Autonomous pipeline mode (v2) and skills management."""
from __future__ import annotations
import argparse
import asyncio
import os

from ._common import (
    _banner, _load_env,
    BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET,
)


def cmd_auto(args: argparse.Namespace) -> None:
    """Autonomous pipeline mode — planner + executor + skill engine."""
    _load_env()

    task = getattr(args, "task", None)
    auto_run = getattr(args, "yes", False)

    if not task:
        _banner("Autonomous Mode")
        print(f"  {DIM}Describe your task. MMCP will plan, pick models, and execute.{RESET}\n")
        print(f"{BOLD}📝 What should the AI do?{RESET}")
        task = input(f"\n  {BOLD}Your task:{RESET} ").strip()
        if not task:
            print(f"{RED}No task provided.{RESET}")
            return

    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not or_key:
        print(f"{RED}Error: OPENROUTER_API_KEY not set{RESET}")
        print(f"{DIM}  Run: mmcp setup{RESET}")
        return

    # Check for similar saved skill
    from ..skill_engine import find_similar_skill, load_skill, save_skill

    similar = find_similar_skill(task)
    use_skill = ""
    if similar:
        print(f"\n{YELLOW}💡 Found similar skill: \"{similar['name']}\" ({similar['similarity']:.0%} match){RESET}")
        print(f"  {DIM}{similar['task']}{RESET}")
        use_skill = input(f"  {BOLD}Use this skill? [Y/n]:{RESET} ").strip().lower()
        if use_skill not in ("n", "no"):
            plan = load_skill(similar["name"])
            if plan:
                plan.task = task
                print(f"\n{GREEN}Using saved skill with {len(plan.steps)} steps{RESET}")
            else:
                similar = None

    # Plan the task
    if not similar or (similar and use_skill in ("n", "no")):
        from ..planner import plan_task

        print(f"\n{BOLD}🧠 Planning...{RESET}", end="", flush=True)
        try:
            plan = asyncio.run(plan_task(task, api_key=or_key))
            print(f" {GREEN}✓{RESET}")
        except Exception as e:
            print(f" {RED}✗{RESET}")
            print(f"{RED}Planning failed: {e}{RESET}")
            return

    # Show the plan
    print(f"\n{plan.to_display()}")

    if not auto_run:
        go = input(f"\n  {BOLD}Execute? [Y/n]:{RESET} ").strip().lower()
        if go in ("n", "no"):
            print(f"{DIM}Cancelled.{RESET}")
            return

    # Execute
    from ..executor import execute_plan, print_plan_progress

    total = len(plan.steps)
    print(f"\n{BOLD}🚀 Executing ({total} steps)...{RESET}\n")

    def on_start(step):
        print_plan_progress(step, total, "start")

    def on_done(step):
        print_plan_progress(step, total, "done")

    result = asyncio.run(execute_plan(
        plan, api_key=or_key,
        on_step_start=on_start, on_step_done=on_done,
    ))

    # Results
    tokens = result.context.get("_total_tokens", 0)
    cost = result.context.get("_total_cost", 0)
    failed = result.context.get("_failed_steps", 0)

    print(f"\n{BOLD}Result:{RESET}")
    if result.status == "done":
        print(f"  Status:  {GREEN}✅ SUCCESS{RESET}")
    elif result.status == "partial":
        print(f"  Status:  {YELLOW}⚠️  PARTIAL ({failed} failed){RESET}")
    else:
        print(f"  Status:  {RED}❌ FAILED{RESET}")

    print(f"  Steps:   {total}")
    print(f"  Tokens:  {tokens:,}")
    print(f"  Cost:    ${cost:.6f}")

    final_output = None
    for step in reversed(result.steps):
        if step.status == "done" and step.output:
            final_output = step.output
            break

    if final_output:
        print(f"\n{BOLD}Output:{RESET}")
        print(final_output)

    # Save as skill?
    if result.status in ("done", "partial"):
        print()
        save = input(f"  {BOLD}💾 Save as reusable skill? [y/N]:{RESET} ").strip().lower()
        if save in ("y", "yes"):
            name = input(f"  {BOLD}Skill name:{RESET} ").strip()
            if name:
                path = save_skill(name, result)
                print(f"  {GREEN}✓ Saved to {path}{RESET}")

    # Run another?
    print()
    again = input(f"  {BOLD}Run another task? [y/N]:{RESET} ").strip().lower()
    if again in ("y", "yes"):
        cmd_auto(args)


def cmd_skills(_args: argparse.Namespace) -> None:
    """List or manage saved skills."""
    from ..skill_engine import list_skills

    skills = list_skills()
    if not skills:
        print(f"{DIM}No saved skills. Run 'mmcp auto' and save a pipeline.{RESET}")
        return

    _banner("Saved Skills")
    for i, s in enumerate(skills, 1):
        print(f"  {CYAN}{i}.{RESET} {BOLD}{s['name']}{RESET} ({s['steps']} steps)")
        print(f"     {DIM}{s['task'][:80]}{RESET}")

    print(f"\n  {DIM}Use these skills when running 'mmcp auto' — they'll be auto-suggested.{RESET}")
