"""Shared context example — append-only cross-node state."""
import asyncio
from mmcp_core import (
    MMCPOrchestrator, RoleBasedRouter, MemoryStore,
    SharedContextStore, MMCPObserver,
)

HAIKU = "claude-haiku-4-5-20251001"


async def main():
    shared = SharedContextStore()
    observer = MMCPObserver()
    observer.enable_console_logging()

    orc = MMCPOrchestrator({
        "router": RoleBasedRouter({
            role: {"model_id": HAIKU}
            for role in ["orchestrator", "researcher", "analyst", "summarizer"]
        }),
        "store": MemoryStore(),
        "shared": shared,
        "observer": observer,
    })

    print("=" * 60)
    print("MMCP Python SDK — Shared Context Store")
    print("=" * 60)

    # Pre-seed shared context
    shared.set("project_name", "MMCP Python SDK", "system")
    shared.set("target_audience", "Enterprise AI teams", "system")

    result = await orc.run_parallel(
        "What are the key benefits of multi-model AI pipelines?",
        ["researcher", "analyst"],
        "summarizer",
    )

    print(f"\n✅ Success: {result.success}")
    print("\n📦 Shared context snapshot:")
    for k, v in shared.snapshot().items():
        print(f"  {k}: {str(v)[:80]}")

    print(f"\n📜 Full history ({len(shared.history())} entries):")
    for entry in shared.history():
        print(f"  v{entry.version} {entry.key} ← {entry.author_ctx_id[:12]}...")

    print(f"\n📝 Output:\n{result.output[:500]}")


if __name__ == "__main__":
    asyncio.run(main())
