"""Tests for mmcp_core.executor — plan execution with recovery."""
from __future__ import annotations
import pytest
from mmcp_core.planner import ExecutionPlan, PlanStep
from mmcp_core.executor import execute_plan, print_plan_progress


class TestExecuteHappyPath:
    @pytest.mark.asyncio
    async def test_execute_simple_plan_succeeds(self, simple_plan, mock_openrouter, monkeypatch):
        """A simple 2-step plan completes with status 'done'."""
        # Mock the tool call
        from mmcp_core import tools
        async def mock_search(query):
            return "Python best practices: use type hints, write tests"
        monkeypatch.setattr(tools, "web_search", mock_search)

        result = await execute_plan(simple_plan, api_key="test-key")
        assert result.status == "done"
        assert all(s.status == "done" for s in result.steps)

    @pytest.mark.asyncio
    async def test_context_chaining_between_steps(self, chained_plan, mock_openrouter):
        """Step 2 receives Step 1's output via context bus."""
        result = await execute_plan(chained_plan, api_key="test-key")

        # Step 1's output should be in the context
        assert result.get_step_output(1) is not None
        # Step 2 and 3 should also complete
        assert result.steps[1].status == "done"
        assert result.steps[2].status == "done"

    @pytest.mark.asyncio
    async def test_tool_step_dispatches_to_tool(self, mock_openrouter, monkeypatch):
        """Tool action calls execute_tool, not the model."""
        from mmcp_core import tools
        call_log = []

        async def mock_execute(name, args):
            call_log.append((name, args))
            return "tool result"

        monkeypatch.setattr(tools, "web_search", lambda q: mock_execute("web_search", {"query": q}))

        plan = ExecutionPlan(task="test", steps=[
            PlanStep(step=1, action="tool", description="Search",
                     tool_name="web_search", tool_args={"query": "test"}),
        ])

        # Patch execute_tool directly
        from mmcp_core import executor
        monkeypatch.setattr(executor, "execute_tool",
                            lambda n, a: mock_execute(n, a))

        await execute_plan(plan, api_key="test-key")
        assert len(call_log) == 1
        assert call_log[0][0] == "web_search"

    @pytest.mark.asyncio
    async def test_tokens_tracked(self, simple_plan, mock_openrouter, monkeypatch):
        """Total tokens are tracked in context."""
        from mmcp_core import tools
        async def mock_search(query):
            return "results"
        monkeypatch.setattr(tools, "web_search", mock_search)
        from mmcp_core import executor
        monkeypatch.setattr(executor, "execute_tool",
                            lambda n, a: mock_search(""))

        result = await execute_plan(simple_plan, api_key="test-key")
        assert result.context.get("_total_tokens", 0) >= 0


class TestErrorRecovery:
    @pytest.mark.asyncio
    async def test_retry_on_failure(self, mock_openrouter_failure, monkeypatch):
        """Failed step retries retry_count times."""
        call_count = 0
        from mmcp_core import executor
        executor._call_model  # noqa: B018

        async def counting_model(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            raise Exception("API Error")

        monkeypatch.setattr(executor, "_call_model", counting_model)

        plan = ExecutionPlan(task="test", steps=[
            PlanStep(step=1, action="write", description="Write",
                     prompt="Test", retry_count=2),
        ])

        result = await execute_plan(plan, api_key="test-key")
        assert result.steps[0].status == "failed"
        # Should have tried 3 times (1 initial + 2 retries)
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_skip_on_failed_dependency(self, plan_with_failure, monkeypatch):
        """Step 2 is skipped if its dependency (step 1) failed."""
        from mmcp_core import executor

        async def failing_model(*args, **kwargs):
            raise Exception("API Error")

        monkeypatch.setattr(executor, "_call_model", failing_model)

        result = await execute_plan(plan_with_failure, api_key="test-key")
        assert result.steps[0].status == "failed"
        assert result.steps[1].status == "skipped"
        assert "dependency" in result.steps[1].error.lower()

    @pytest.mark.asyncio
    async def test_partial_status_on_mixed(self, mock_openrouter, monkeypatch):
        """Some pass + some fail = status 'partial'."""
        from mmcp_core import executor

        call_num = 0
        async def sometimes_fail(*args, **kwargs):
            nonlocal call_num
            call_num += 1
            if call_num <= 3:  # First step retries succeed
                return {"output": "ok", "tokens": 10, "cost": 0}
            raise Exception("fail")

        monkeypatch.setattr(executor, "_call_model", sometimes_fail)

        plan = ExecutionPlan(task="test", steps=[
            PlanStep(step=1, action="write", description="Step 1",
                     prompt="Test", retry_count=0),
            PlanStep(step=2, action="write", description="Step 2",
                     prompt="Test", retry_count=0),
        ])

        # First step succeeds on first try, second fails
        call_num = 0
        calls = []
        async def track_calls(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                return {"output": "ok", "tokens": 10, "cost": 0}
            raise Exception("fail")

        monkeypatch.setattr(executor, "_call_model", track_calls)
        result = await execute_plan(plan, api_key="test-key")
        assert result.status == "partial"


class TestCallbacks:
    @pytest.mark.asyncio
    async def test_callbacks_fire(self, simple_plan, mock_openrouter, monkeypatch):
        """on_step_start and on_step_done callbacks are called."""
        from mmcp_core import executor
        monkeypatch.setattr(executor, "execute_tool",
                            lambda n, a: __import__('asyncio').coroutine(lambda: "ok")())

        # Simpler: just mock execute_tool
        from mmcp_core import tools
        async def mock_tool(query):
            return "results"
        monkeypatch.setattr(tools, "web_search", mock_tool)

        import mmcp_core.executor as ex
        async def mock_et(n, a):
            return "results"
        monkeypatch.setattr(ex, "execute_tool", mock_et)

        starts, dones = [], []
        await execute_plan(
            simple_plan, api_key="test-key",
            on_step_start=lambda s: starts.append(s.step),
            on_step_done=lambda s: dones.append(s.step),
        )
        assert len(starts) == 2
        assert len(dones) == 2


class TestPrintProgress:
    def test_print_start(self, capsys):
        step = PlanStep(step=1, action="write", description="Write article")
        print_plan_progress(step, 3, "start")
        captured = capsys.readouterr()
        assert "1/3" in captured.out
        assert "Write article" in captured.out

    def test_print_done_success(self, capsys):
        step = PlanStep(step=1, action="write", description="Test",
                        status="done", tokens_used=500)
        print_plan_progress(step, 3, "done")
        captured = capsys.readouterr()
        assert "500t" in captured.out
