"""Tests for mmcp_core.planner — task decomposition and plan structure."""
from __future__ import annotations
import json
import pytest
from mmcp_core.planner import (
    ExecutionPlan, PlanStep, ACTION_TO_MODEL, FALLBACK_MODEL, plan_task,
)


# ── Model routing ───────────────────────────────────────────────────────────

class TestModelRouting:
    def test_resolve_model_maps_correctly(self):
        """Each action type maps to the expected model."""
        step = PlanStep(step=1, action="code", description="test")
        assert step.resolve_model() == "google/gemini-2.5-pro-preview"

        step2 = PlanStep(step=1, action="research", description="test")
        assert step2.resolve_model() == "deepseek/deepseek-r1"

        step3 = PlanStep(step=1, action="write", description="test")
        assert step3.resolve_model() == "anthropic/claude-sonnet-4"

    def test_resolve_model_uses_explicit_model(self):
        """If model is explicitly set, it overrides action-based routing."""
        step = PlanStep(step=1, action="code", description="test",
                        model="custom/model")
        assert step.resolve_model() == "custom/model"

    def test_resolve_model_fallback_for_unknown_action(self):
        """Unknown action types fall back to FALLBACK_MODEL."""
        step = PlanStep(step=1, action="unknown_action", description="test")
        assert step.resolve_model() == FALLBACK_MODEL

    def test_tool_action_resolves_to_none(self):
        """Tool actions don't need a model."""
        step = PlanStep(step=1, action="tool", description="test")
        assert step.resolve_model() is None

    def test_all_action_types_in_map(self):
        """Verify all documented action types exist in ACTION_TO_MODEL."""
        expected = {"research", "analyze", "code", "generate", "write",
                    "review", "summarize", "translate", "quick", "math",
                    "creative", "tool", "mcp"}
        assert expected == set(ACTION_TO_MODEL.keys())


# ── Plan structure ──────────────────────────────────────────────────────────

class TestPlanStructure:
    def test_plan_step_defaults(self):
        """PlanStep has correct defaults for error recovery."""
        step = PlanStep(step=1, action="write", description="test")
        assert step.retry_count == 2
        assert step.fallback_model == FALLBACK_MODEL
        assert step.status == "pending"
        assert step.depends_on == []

    def test_execution_plan_display(self, simple_plan):
        """to_display() returns human-readable plan."""
        display = simple_plan.to_display()
        assert "test task" in display
        assert "Step 1" in display
        assert "Step 2" in display


# ── Context chaining ────────────────────────────────────────────────────────

class TestContextChaining:
    def test_set_and_get_step_output(self):
        """Context bus stores and retrieves step outputs."""
        plan = ExecutionPlan(task="test", steps=[])
        plan.set_step_output(1, "output from step 1")
        assert plan.get_step_output(1) == "output from step 1"
        assert plan.get_step_output(99) is None

    def test_build_step_prompt_injects_context(self, chained_plan):
        """Dependent step prompt includes parent output."""
        plan = chained_plan
        plan.set_step_output(1, "Research results here")

        prompt = plan.build_step_prompt(plan.steps[1])  # step 2
        assert "Research results here" in prompt
        assert "Research topic" in prompt  # parent description
        assert "Write an article" in prompt  # own prompt

    def test_build_step_prompt_no_deps(self, simple_plan):
        """Step with no dependencies gets just its own prompt."""
        plan = simple_plan
        prompt = plan.build_step_prompt(plan.steps[0])  # step 1
        assert "Context from previous steps" not in prompt


# ── JSON parsing (plan_task) ────────────────────────────────────────────────

class TestPlanTaskParsing:
    @pytest.mark.asyncio
    async def test_plan_task_parses_json(self, mock_openrouter, monkeypatch):
        """plan_task parses valid JSON from LLM response."""
        import httpx

        valid_plan = json.dumps([
            {"step": 1, "action": "research", "description": "Research",
             "prompt": "Do research", "depends_on": []},
            {"step": 2, "action": "write", "description": "Write",
             "prompt": "Write it up", "depends_on": [1]},
        ])

        class PlanResponse:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": valid_plan}}],
                        "usage": {"total_tokens": 50}}
            def raise_for_status(self): pass

        class PlanClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass
            async def post(self, *a, **kw): return PlanResponse()

        monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: PlanClient())

        plan = await plan_task("test task", api_key="test-key")
        assert len(plan.steps) == 2
        assert plan.steps[0].action == "research"
        assert plan.steps[1].depends_on == [1]

    @pytest.mark.asyncio
    async def test_plan_task_handles_code_blocks(self, mock_openrouter, monkeypatch):
        """plan_task strips markdown code fences."""
        import httpx

        wrapped = '```json\n[{"step": 1, "action": "quick", "description": "Do it", "depends_on": []}]\n```'

        class FencedResponse:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": wrapped}}],
                        "usage": {"total_tokens": 30}}
            def raise_for_status(self): pass

        class FencedClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass
            async def post(self, *a, **kw): return FencedResponse()

        monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: FencedClient())

        plan = await plan_task("test", api_key="test-key")
        assert len(plan.steps) == 1
        assert plan.steps[0].action == "quick"
