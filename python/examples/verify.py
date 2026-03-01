"""Verify example — producer + challenger + synthesizer."""
import asyncio
from mmcp_core import MMCPOrchestrator, RoleBasedRouter, MemoryStore, MMCPObserver

HAIKU = "claude-haiku-4-5-20251001"


async def main():
    observer = MMCPObserver()
    observer.enable_console_logging()

    orc = MMCPOrchestrator({
        "router": RoleBasedRouter({
            role: {"model_id": HAIKU}
            for role in ["expert", "challenger", "synthesizer"]
        }),
        "store": MemoryStore(),
        "observer": observer,
    })

    print("=" * 60)
    print("MMCP Python SDK — Verification Pipeline")
    print("=" * 60)

    result = await orc.run_verify(
        "Is Rust safer than C++? Explain.",
        "expert", "challenger", "synthesizer",
    )

    print(f"\n✅ Success: {result.success}")
    print(f"📊 Total nodes: {result.total_nodes}")
    print(f"🪙 Total tokens: {result.total_tokens}")

    synth = next(c for c in result.dag if c.role == "synthesizer")
    print(f"\n🔗 Synthesizer parent count: {len(synth.parent_ids)} (DAG proof)")
    print(f"\n📝 Final output:\n{result.output[:500]}")

    orc.store.print_dag()


if __name__ == "__main__":
    asyncio.run(main())
