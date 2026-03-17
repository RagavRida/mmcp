"""Shared test fixtures for MMCP v2 test suite."""
from __future__ import annotations
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from mmcp_core.planner import ExecutionPlan, PlanStep, ACTION_TO_MODEL


# ── Ensure no real API calls ────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _block_real_api(monkeypatch):
    """Remove API keys so tests can't accidentally make real API calls."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


# ── Plan fixtures ───────────────────────────────────────────────────────────

@pytest.fixture
def simple_plan():
    """A 2-step plan: tool call → summarize."""
    return ExecutionPlan(
        task="test task",
        steps=[
            PlanStep(step=1, action="tool", description="Search web",
                     tool_name="web_search", tool_args={"query": "python tips"}),
            PlanStep(step=2, action="summarize", description="Summarize results",
                     prompt="Summarize the search results", depends_on=[1]),
        ],
    )


@pytest.fixture
def chained_plan():
    """A 3-step plan with full dependency chain: 1→2→3."""
    return ExecutionPlan(
        task="chained task",
        steps=[
            PlanStep(step=1, action="research", description="Research topic",
                     prompt="Research AI trends"),
            PlanStep(step=2, action="write", description="Write article",
                     prompt="Write an article about the research", depends_on=[1]),
            PlanStep(step=3, action="review", description="Review article",
                     prompt="Review and polish the article", depends_on=[2]),
        ],
    )


@pytest.fixture
def plan_with_failure():
    """A plan where step 2 depends on step 1 (which will fail)."""
    return ExecutionPlan(
        task="failure task",
        steps=[
            PlanStep(step=1, action="code", description="Generate code",
                     prompt="Write Python code", retry_count=0),
            PlanStep(step=2, action="review", description="Review code",
                     prompt="Review the code", depends_on=[1]),
        ],
    )


# ── Mock OpenRouter responses ──────────────────────────────────────────────

class MockHTTPResponse:
    """Mock httpx response for OpenRouter API."""
    def __init__(self, content="Mock LLM output", tokens=100, cost=0.001):
        self._content = content
        self._tokens = tokens
        self._cost = cost
        self.status_code = 200

    def json(self):
        return {
            "choices": [{"message": {"content": self._content}}],
            "usage": {"total_tokens": self._tokens, "cost": self._cost},
        }

    def raise_for_status(self):
        pass


class MockHTTPClient:
    """Mock httpx.AsyncClient."""
    def __init__(self, response=None):
        self._response = response or MockHTTPResponse()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, *args, **kwargs):
        return self._response

    async def get(self, *args, **kwargs):
        return self._response

    async def request(self, *args, **kwargs):
        return self._response


@pytest.fixture
def mock_openrouter(monkeypatch):
    """Patch httpx.AsyncClient to return mock responses."""
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: MockHTTPClient())
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-123")


@pytest.fixture
def mock_openrouter_failure(monkeypatch):
    """Patch httpx.AsyncClient to raise an error."""
    import httpx

    class FailingClient(MockHTTPClient):
        async def post(self, *args, **kwargs):
            raise httpx.HTTPStatusError(
                "500 Server Error", request=MagicMock(), response=MagicMock()
            )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: FailingClient())
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-123")


# ── Temp directory for skills ───────────────────────────────────────────────

@pytest.fixture
def tmp_skills_dir(tmp_path, monkeypatch):
    """Redirect skills storage to a temp directory."""
    import mmcp_core.skill_engine as se
    monkeypatch.setattr(se, "SKILLS_DIR", tmp_path)
    return tmp_path
