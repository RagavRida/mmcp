"""Tests for the LangGraph/LangChain tracer."""
import pytest
import json
import os


def test_tracer_exports_json(tmp_path):
    """Test export produces valid JSON with correct structure."""
    from langchain_mmcp import MMCPTracer
    from mmcp_core import create_context

    tracer = MMCPTracer(
        export_path=str(tmp_path),
        auto_export=False,
        regulation_tags=["SOC2"],
    )

    # Manually add contexts (no API call needed)
    ctx1 = create_context(task="test analyze", role="analyzer", model="claude-haiku")
    ctx1.status = "done"
    ctx1.output = "Analysis output"
    ctx1.completed_at = "2026-01-01T00:00:00+00:00"

    ctx2 = create_context(
        task="test review", role="reviewer", model="claude-haiku",
        parent_ids=[ctx1.id],
    )
    ctx2.status = "done"
    ctx2.output = "Review output"
    ctx2.completed_at = "2026-01-01T00:00:01+00:00"

    tracer._contexts = [ctx1, ctx2]
    filepath = tracer.export()

    assert filepath.endswith(".json")
    assert os.path.exists(filepath)

    with open(filepath) as f:
        data = json.load(f)

    assert data["mmcp"] == "1.0"
    assert len(data["envelopes"]) == 2
    assert data["regulation_tags"] == ["SOC2"]
    assert "audit_chain" in data["compliance_report"]


def test_tracer_wire_dag_structure():
    """Test get_wire_dag returns correct MMCP structure."""
    from langchain_mmcp import MMCPTracer
    from mmcp_core import create_context

    tracer = MMCPTracer(regulation_tags=["GDPR", "HIPAA"])

    ctx = create_context(task="test", role="llm", model="claude-haiku")
    ctx.status = "done"
    ctx.output = "test output"
    tracer._contexts = [ctx]

    wire_dag = tracer.get_wire_dag()
    assert wire_dag["mmcp"] == "1.0"
    assert wire_dag["regulation_tags"] == ["GDPR", "HIPAA"]
    assert wire_dag["dag_id"].startswith("mmcp_dag_")
    assert len(wire_dag["envelopes"]) == 1
    assert wire_dag["envelopes"][0]["compliance"]["audit_hash"]


def test_tracer_print_summary(capsys):
    """Test print_summary produces readable output."""
    from langchain_mmcp import MMCPTracer
    from mmcp_core import create_context

    tracer = MMCPTracer()
    ctx = create_context(task="test", role="llm", model="claude-haiku")
    ctx.status = "done"
    ctx.tokens_used = 100
    ctx.duration_ms = 500
    tracer._contexts = [ctx]

    tracer.print_summary()
    output = capsys.readouterr().out
    assert "MMCP Audit Summary" in output
    assert "Total nodes:  1" in output
    assert "Total tokens: 100" in output


@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY not set",
)
@pytest.mark.asyncio
async def test_tracer_with_real_langchain():
    """Integration test with real LangChain + Anthropic."""
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage
    except ImportError:
        pytest.skip("langchain-anthropic not installed")

    from langchain_mmcp import MMCPTracer

    tracer = MMCPTracer(regulation_tags=["SOC2"])
    llm = ChatAnthropic(model="claude-haiku-4-5-20251001")
    response = llm.invoke(
        [HumanMessage(content="What is 1+1?")],
        config={"callbacks": [tracer]},
    )
    wire_dag = tracer.get_wire_dag()
    assert wire_dag["mmcp"] == "1.0"
    assert len(wire_dag["envelopes"]) > 0
    assert wire_dag["regulation_tags"] == ["SOC2"]
