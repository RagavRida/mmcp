"""
THE FLAGSHIP EXAMPLE.
Shows MMCPTracer on a real LangGraph pipeline.
One line → full MMCP audit trail with SHA-256 hashes.
"""
import asyncio


async def main():
    try:
        from langgraph.graph import StateGraph, END
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage, SystemMessage
        from typing import TypedDict, Annotated
        import operator
    except ImportError:
        print(
            "Install: pip install mmcp-core[langchain] "
            "langchain-anthropic langgraph"
        )
        return

    from langchain_mmcp import MMCPTracer

    # ── Build a real LangGraph pipeline ─────────────────────────────────────

    class AgentState(TypedDict):
        messages: Annotated[list, operator.add]
        analysis: str
        review: str

    llm = ChatAnthropic(model="claude-haiku-4-5-20251001")

    def analyze_node(state: AgentState) -> dict:
        response = llm.invoke([
            SystemMessage(content="You are a code analyzer. Be concise."),
            HumanMessage(
                content=(
                    f"Analyze this code briefly: "
                    f"{state['messages'][-1].content}"
                )
            ),
        ])
        return {"analysis": response.content, "messages": [response]}

    def review_node(state: AgentState) -> dict:
        response = llm.invoke([
            SystemMessage(content="You are a code reviewer. Be concise."),
            HumanMessage(
                content=(
                    f"Review this analysis and suggest one improvement: "
                    f"{state['analysis']}"
                )
            ),
        ])
        return {"review": response.content, "messages": [response]}

    # Build the graph
    graph = StateGraph(AgentState)
    graph.add_node("analyzer", analyze_node)
    graph.add_node("reviewer", review_node)
    graph.add_edge("analyzer", "reviewer")
    graph.add_edge("reviewer", END)
    graph.set_entry_point("analyzer")
    app = graph.compile()

    # ── Add MMCP tracer — ONE LINE ──────────────────────────────────────────
    tracer = MMCPTracer(
        regulation_tags=["SOC2", "GDPR"],
        export_path="./mmcp-audits/",
        auto_export=True,
    )

    # ── Run the pipeline ────────────────────────────────────────────────────
    print("Running LangGraph pipeline with MMCP audit tracing...\n")
    result = app.invoke(
        {
            "messages": [
                HumanMessage(
                    content=(
                        "def login(user, pwd): "
                        "return db.query(f'SELECT * FROM users WHERE pwd={pwd}')"
                    )
                )
            ]
        },
        config={"callbacks": [tracer]},
    )

    # ── Show outputs ────────────────────────────────────────────────────────
    print("=" * 60)
    print("PIPELINE OUTPUT")
    print("=" * 60)
    print(f"Analysis: {result['analysis'][:200]}")
    print(f"Review:   {result['review'][:200]}")

    print("\n" + "=" * 60)
    print("MMCP AUDIT TRAIL")
    print("=" * 60)
    tracer.print_summary()

    wire_dag = tracer.get_wire_dag()
    print(f"\nDAG ID: {wire_dag['dag_id']}")
    print(f"Regulation tags: {wire_dag['regulation_tags']}")
    audit_chain = wire_dag["compliance_report"]["audit_chain"]
    print(f"\nAudit chain ({len(audit_chain)} entries):")
    for entry in audit_chain:
        print(
            f"  [{entry['sequence']}] {entry['role']} "
            f"— hash: {entry['audit_hash'][:16]}..."
        )

    print("\n✅ Audit trail exported to: ./mmcp-audits/")
    print("   Import this JSON into any compliance system")
    print("   SHA-256 hashes prove outputs haven't been tampered with")


if __name__ == "__main__":
    asyncio.run(main())
