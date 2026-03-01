"""Tests for wire format serialization."""
import pytest
from mmcp_core import create_context
from mmcp_core.wire import MMCPWireFormat

HAIKU = "claude-haiku-4-5-20251001"


def test_serialize_envelope():
    ctx = create_context(task="test", role="tester", model=HAIKU)
    ctx.status = "done"
    ctx.output = "Hello world"
    ctx.tokens_used = 50
    ctx.input_tokens = 30
    ctx.output_tokens = 20
    ctx.completed_at = "2026-01-01T00:00:00+00:00"

    fmt = MMCPWireFormat()
    envelope = fmt.serialize(ctx)

    assert envelope["mmcp"] == "1.0"
    assert envelope["id"] == ctx.id
    assert envelope["role"] == "tester"
    assert envelope["status"] == "done"
    assert envelope["output"] == "Hello world"
    assert envelope["output_preview"] == "Hello world"
    assert envelope["tokens_used"] == 50
    assert "audit_hash" in envelope["compliance"]
    assert len(envelope["compliance"]["audit_hash"]) == 64  # SHA-256


def test_serialize_dag():
    a = create_context(task="t", role="a", model=HAIKU, branch_type="root")
    a.status = "done"
    a.output = "Output A"
    a.completed_at = "2026-01-01T00:00:00+00:00"
    b = create_context(
        task="t", role="b", model=HAIKU, parent_ids=[a.id]
    )
    b.status = "done"
    b.output = "Output B"
    b.completed_at = "2026-01-01T00:00:01+00:00"

    fmt = MMCPWireFormat()
    dag = fmt.serialize_dag([a, b], regulation_tags=["SOC2"])

    assert dag["mmcp"] == "1.0"
    assert dag["dag_id"].startswith("mmcp_dag_")
    assert len(dag["envelopes"]) == 2
    assert dag["regulation_tags"] == ["SOC2"]
    assert dag["compliance_report"]["valid"] is True
    assert dag["compliance_report"]["total_nodes"] == 2
    assert len(dag["compliance_report"]["audit_chain"]) == 2


def test_audit_hash_changes_with_output():
    fmt = MMCPWireFormat()
    ctx = create_context(task="t", role="r", model=HAIKU)
    ctx.status = "done"
    ctx.output = "version 1"
    hash1 = fmt.serialize(ctx)["compliance"]["audit_hash"]

    ctx.output = "version 2"
    hash2 = fmt.serialize(ctx)["compliance"]["audit_hash"]

    assert hash1 != hash2  # tamper detection


def test_dag_cost_aggregation():
    fmt = MMCPWireFormat()
    a = create_context(task="t", role="a", model=HAIKU)
    a.status = "done"
    a.cost_usd = 0.001
    b = create_context(task="t", role="b", model=HAIKU)
    b.status = "done"
    b.cost_usd = 0.002

    dag = fmt.serialize_dag([a, b])
    assert dag["total_cost_usd"] == pytest.approx(0.003, abs=1e-6)


def test_verified_nodes_in_compliance():
    fmt = MMCPWireFormat()
    producer = create_context(task="t", role="expert", model=HAIKU)
    producer.status = "done"
    synth = create_context(
        task="t", role="synth", model=HAIKU,
        metadata={"verify_role": "synthesizer"}
    )
    synth.status = "done"

    dag = fmt.serialize_dag([producer, synth])
    assert synth.id in dag["compliance_report"]["verified_nodes"]


def test_envelope_id_unique():
    fmt = MMCPWireFormat()
    ctx = create_context(task="t", role="r", model=HAIKU)
    ctx.status = "done"
    e1 = fmt.serialize(ctx)
    e2 = fmt.serialize(ctx)
    assert e1["envelope_id"] != e2["envelope_id"]  # globally unique
