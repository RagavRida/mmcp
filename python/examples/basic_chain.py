"""Basic chain example — sequential handoff pipeline."""
import asyncio
from mmcp_core import MMCPOrchestrator, RoleBasedRouter, MemoryStore, MMCPObserver

HAIKU = "claude-haiku-4-5-20251001"


async def main():
    observer = MMCPObserver()
    observer.enable_console_logging()

    orc = MMCPOrchestrator({
        "router": RoleBasedRouter({
            "architect": {"model_id": HAIKU},
            "reviewer": {"model_id": HAIKU},
        }),
        "store": MemoryStore(),
        "observer": observer,
    })

    print("=" * 60)
    print("MMCP Python SDK — Basic Chain Example")
    print("=" * 60)

    result = await orc.run_chain(
        "Explain the observer pattern in Python in 3 bullet points.",
        ["architect", "reviewer"],
    )

    print(f"\n✅ Success: {result.success}")
    print(f"📊 Total nodes: {result.total_nodes}")
    print(f"🪙 Total tokens: {result.total_tokens}")
    print(f"💰 Cost: ${result.total_cost_usd:.6f}")
    print(f"⏱  Duration: {result.duration_ms}ms")
    print(f"\n📝 Output:\n{result.output[:500]}")


if __name__ == "__main__":
    asyncio.run(main())
