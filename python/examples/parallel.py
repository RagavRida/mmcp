"""Parallel fork + merge example."""
import asyncio
from mmcp_core import MMCPOrchestrator, RoleBasedRouter, MemoryStore, MMCPObserver

HAIKU = "claude-haiku-4-5-20251001"


async def main():
    observer = MMCPObserver()
    observer.enable_console_logging()

    orc = MMCPOrchestrator({
        "router": RoleBasedRouter({
            role: {"model_id": HAIKU}
            for role in ["orchestrator", "coder", "analyst", "summarizer"]
        }),
        "store": MemoryStore(),
        "observer": observer,
    })

    print("=" * 60)
    print("MMCP Python SDK — Parallel Fork + Merge")
    print("=" * 60)

    result = await orc.run_parallel(
        "What are the pros and cons of microservices?",
        ["coder", "analyst"],
        "summarizer",
    )

    print(f"\n✅ Success: {result.success}")
    print(f"📊 Total nodes: {result.total_nodes}")
    print(f"🪙 Total tokens: {result.total_tokens}")
    print(f"💰 Cost: ${result.total_cost_usd:.6f}")
    print(f"\n📝 Output:\n{result.output[:500]}")

    # Show DAG
    orc.store.print_dag()


if __name__ == "__main__":
    asyncio.run(main())
