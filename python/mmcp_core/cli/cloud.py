"""Cloud commands: login, logout, account, setup."""
from __future__ import annotations
import argparse
import asyncio
import os

from ._common import (
    _banner, _load_env, _mask_key,
    BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET,
)
from ..cloud import (
    load_cloud_config, save_cloud_config, remove_cloud_config,
    DEFAULT_CLOUD_URL,
)


def cmd_login(args: argparse.Namespace) -> None:
    """Login to MMCP Cloud or create an account."""
    _banner("MMCP Cloud Login")
    cloud_url = getattr(args, "url", DEFAULT_CLOUD_URL)

    config = load_cloud_config()
    if config and config.get("api_key"):
        print(f"  {GREEN}Already logged in as {config.get('email', '?')}{RESET}")
        relogin = input(f"  {BOLD}Re-login? [y/N]:{RESET} ").strip().lower()
        if relogin not in ("y", "yes"):
            return

    print(f"\n{BOLD}Choose:{RESET}")
    print(f"  {CYAN}1{RESET}  Login with existing account")
    print(f"  {CYAN}2{RESET}  Create new account")

    choice = input(f"\n  {BOLD}Select [1/2]:{RESET} ").strip() or "1"

    email = input(f"\n  {BOLD}Email:{RESET} ").strip()
    if not email:
        print(f"{RED}Email required.{RESET}")
        return

    import getpass
    password = getpass.getpass(f"  {BOLD}Password:{RESET} ")
    if not password:
        print(f"{RED}Password required.{RESET}")
        return

    try:
        import httpx

        if choice == "2":
            if len(password) < 8:
                print(f"{RED}Password must be at least 8 characters.{RESET}")
                return

            print(f"\n{BOLD}Creating account...{RESET}")
            resp = httpx.post(
                f"{cloud_url}/v1/auth/register",
                json={"email": email, "password": password},
                timeout=15.0,
            )
            if resp.status_code == 409:
                print(f"{YELLOW}Account already exists. Trying login...{RESET}")
                choice = "1"
            elif resp.status_code != 200:
                print(f"{RED}Registration failed: {resp.text}{RESET}")
                return
            else:
                data = resp.json()
                save_cloud_config({
                    "api_key": data["api_key"],
                    "email": email,
                    "plan": data.get("plan", "free"),
                    "cloud_url": cloud_url,
                })
                print(f"\n  {GREEN}✅ Account created!{RESET}")
                print(f"  Email:   {email}")
                print(f"  Plan:    {data.get('plan', 'free')}")
                print(f"  API Key: {data['api_key'][:15]}...")
                print(f"\n  {CYAN}Run: mmcp run{RESET}")
                return

        if choice == "1":
            print(f"\n{BOLD}Logging in...{RESET}")
            resp = httpx.post(
                f"{cloud_url}/v1/auth/login",
                json={"email": email, "password": password},
                timeout=15.0,
            )
            if resp.status_code != 200:
                print(f"{RED}Login failed: {resp.json().get('detail', resp.text)}{RESET}")
                return

            data = resp.json()
            save_cloud_config({
                "api_key": data["api_key"],
                "email": email,
                "plan": data.get("plan", "free"),
                "cloud_url": cloud_url,
            })
            print(f"\n  {GREEN}✅ Logged in!{RESET}")
            print(f"  Email: {email}")
            print(f"  Plan:  {data.get('plan', 'free')}")
            print(f"\n  {CYAN}Run: mmcp run{RESET}")

    except ImportError:
        print(f"{RED}httpx required: pip install httpx{RESET}")
    except Exception as e:
        if "ConnectError" in type(e).__name__:
            print(f"{RED}Cannot connect to {cloud_url}{RESET}")
            print(f"{DIM}Is the MMCP Cloud server running?{RESET}")
            print(f"{DIM}  Start it: uvicorn mmcp_cloud.server:app --port 8765{RESET}")
        else:
            print(f"{RED}Error: {e}{RESET}")


def cmd_logout(_args: argparse.Namespace) -> None:
    """Remove MMCP Cloud credentials."""
    config = load_cloud_config()
    if not config:
        print(f"{DIM}Not logged in.{RESET}")
        return

    email = config.get("email", "?")
    remove_cloud_config()
    print(f"{GREEN}✓ Logged out ({email}){RESET}")


def cmd_account(_args: argparse.Namespace) -> None:
    """Show account usage and billing info."""
    config = load_cloud_config()
    if not config or not config.get("api_key"):
        print(f"{RED}Not logged in. Run 'mmcp login' first.{RESET}")
        return

    _banner("MMCP Cloud Account")
    cloud_url = config.get("cloud_url", DEFAULT_CLOUD_URL)
    api_key = config["api_key"]

    try:
        import httpx

        headers = {"Authorization": f"Bearer {api_key}"}
        usage_resp = httpx.get(f"{cloud_url}/v1/account/usage", headers=headers, timeout=10.0)
        plan_resp = httpx.get(f"{cloud_url}/v1/account/plan", headers=headers, timeout=10.0)

        if usage_resp.status_code != 200 or plan_resp.status_code != 200:
            print(f"{RED}Failed to fetch account info.{RESET}")
            return

        usage = usage_resp.json()
        plan = plan_resp.json()

        month = usage.get("this_month", {})
        total = usage.get("all_time", {})

        print(f"  Email:       {usage.get('email', '?')}")
        print(f"  Plan:        {BOLD}{plan.get('plan_name', '?')}{RESET} (${plan.get('price_usd', 0)}/mo)")
        print(f"  Markup:      {plan.get('markup_pct', 15)}%")

        print(f"\n{BOLD}This Month:{RESET}")
        limit = month.get("limit", 0)
        remaining = month.get("remaining", 0)
        runs = month.get("runs", 0)
        limit_str = "unlimited" if limit == -1 else str(limit)
        remaining_str = "∞" if remaining == -1 else str(remaining)

        print(f"  Runs:        {runs} / {limit_str}")
        print(f"  Remaining:   {remaining_str}")
        print(f"  Tokens:      {month.get('tokens', 0):,}")
        print(f"  Cost:        ${month.get('cost_usd', 0):.4f}")

        print(f"\n{BOLD}All Time:{RESET}")
        print(f"  Runs:        {total.get('runs', 0):,}")
        print(f"  Tokens:      {total.get('tokens', 0):,}")
        print(f"  Cost:        ${total.get('cost_usd', 0):.4f}")

        avail = plan.get("available_plans", {})
        if avail:
            print(f"\n{BOLD}Available Plans:{RESET}")
            for pid, p in avail.items():
                current = " ← current" if pid == plan.get("plan_id") else ""
                runs_str = "unlimited" if p["runs"] == -1 else f"{p['runs']}/mo"
                print(f"  {CYAN}{p['name']:8s}{RESET} ${p['price']:>3}/mo  {runs_str}{DIM}{current}{RESET}")

    except ImportError:
        print(f"{RED}httpx required: pip install httpx{RESET}")
    except Exception as e:
        if "ConnectError" in type(e).__name__:
            print(f"{RED}Cannot connect to {cloud_url}{RESET}")
            print(f"{DIM}Showing local config only:{RESET}")
            print(f"  Email: {config.get('email', '?')}")
            print(f"  Plan:  {config.get('plan', '?')}")
        else:
            print(f"{RED}Error: {e}{RESET}")


def cmd_setup(_args: argparse.Namespace) -> None:
    """Interactive setup wizard for MMCP."""
    _banner("Setup Wizard")
    _load_env()

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

    or_key = existing.get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY", "")
    an_key = existing.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    print(f"\n{BOLD}Current API Keys:{RESET}")
    print(f"  OPENROUTER_API_KEY:  {_mask_key(or_key) if or_key else f'{RED}not set{RESET}'}")
    print(f"  ANTHROPIC_API_KEY:   {_mask_key(an_key) if an_key else f'{YELLOW}not set{RESET}'}")

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

    if updated != existing and choice != "4":
        _write_env_file(env_file, updated)
        print(f"\n  {GREEN}✓ Saved to {env_file}{RESET}")
        for k, v in updated.items():
            os.environ[k] = v
    elif choice == "4":
        print(f"\n  {DIM}Skipped — keeping current config{RESET}")

    test_key = or_key or an_key
    if not test_key:
        print(f"\n  {YELLOW}⚠ No API key configured. Run 'mmcp setup' again to add one.{RESET}")
        return

    print(f"\n{BOLD}Testing connection...{RESET}")
    use_or = bool(or_key)
    provider = "OpenRouter" if use_or else "Anthropic"
    model = "anthropic/claude-3.5-haiku" if use_or else "claude-haiku-4-5-20251001"

    try:
        result = asyncio.run(_test_connection(use_or, model))
        print(f"  {GREEN}✓ {provider} connection OK{RESET}")
        print(f"  Model:  {result.get('model', model)}")
        print(f"  Output: {result.get('output', '')[:80]}")
        print(f"  Tokens: {result.get('tokens_used', 0)}")
    except Exception as e:
        print(f"  {RED}✗ {provider} connection failed: {e}{RESET}")
        print(f"  {DIM}Check your API key and try again.{RESET}")
        return

    print(f"\n{GREEN}{'═' * 60}{RESET}")
    print(f"{GREEN}  ✅ MMCP is ready!{RESET}")
    print(f"{GREEN}{'═' * 60}{RESET}")
    flag = " --openrouter" if use_or else ""
    print(f"\n  Try: {CYAN}mmcp chain \"Explain DAGs\" -r architect,reviewer{flag}{RESET}")
    print()


async def _test_connection(use_openrouter: bool, model: str) -> dict:
    """Quick test call to verify API key works."""
    from ..adapter import call_openrouter, call_anthropic
    from ..types import ModelAssignment
    from ..context import create_context

    ctx = create_context(task="Say hello in exactly one word.", role="test", model=model)
    assignment = ModelAssignment(
        model_id=model, endpoint="",
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

    for key, val in entries.items():
        if key not in existing_keys:
            lines.append(f"{key}={val}\n")

    with open(path, "w") as f:
        f.writelines(lines)
