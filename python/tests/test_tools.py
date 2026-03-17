"""Tests for mmcp_core.tools — built-in tool functions."""
from __future__ import annotations
import os
import pytest
from mmcp_core.tools import (
    web_search, http_request, read_file, write_file,
    run_command, execute_tool, COMMAND_ALLOWLIST,
)


class TestWebSearch:
    @pytest.mark.asyncio
    async def test_web_search_returns_string(self):
        """web_search returns a non-empty string."""
        result = await web_search("python programming")
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_web_search_no_results(self):
        """Nonsense query returns a graceful message."""
        result = await web_search("xyzzy99999nonexistent")
        assert isinstance(result, str)
        # Should either return results or a "no results" message


class TestFileOperations:
    @pytest.mark.asyncio
    async def test_read_file_exists(self, tmp_path):
        """read_file returns content of existing file."""
        f = tmp_path / "test.txt"
        f.write_text("hello world")
        result = await read_file(str(f))
        assert result == "hello world"

    @pytest.mark.asyncio
    async def test_read_file_missing(self):
        """read_file returns error for missing file."""
        result = await read_file("/nonexistent/file.txt")
        assert "Error" in result or "not found" in result.lower()

    @pytest.mark.asyncio
    async def test_write_file_creates(self, tmp_path):
        """write_file creates file with content."""
        f = tmp_path / "output.txt"
        result = await write_file(str(f), "test content")
        assert "✅" in result
        assert f.read_text() == "test content"

    @pytest.mark.asyncio
    async def test_write_file_creates_dirs(self, tmp_path):
        """write_file creates parent directories."""
        f = tmp_path / "sub" / "dir" / "file.txt"
        result = await write_file(str(f), "nested content")
        assert "✅" in result
        assert f.read_text() == "nested content"


class TestRunCommand:
    @pytest.mark.asyncio
    async def test_allowed_command(self):
        """Allowlisted command executes successfully."""
        result = await run_command("echo hello")
        assert "hello" in result

    @pytest.mark.asyncio
    async def test_blocked_command(self):
        """Non-allowlisted command is blocked."""
        result = await run_command("rm -rf /")
        assert "BLOCKED" in result

    @pytest.mark.asyncio
    async def test_all_allowlist_prefixes_work(self):
        """Verify allowlist contains expected safe commands."""
        assert "echo" in COMMAND_ALLOWLIST
        assert "cat" in COMMAND_ALLOWLIST
        assert "ls" in COMMAND_ALLOWLIST
        # Dangerous commands should NOT be in allowlist
        assert "rm" not in COMMAND_ALLOWLIST
        assert "sudo" not in COMMAND_ALLOWLIST


class TestToolDispatcher:
    @pytest.mark.asyncio
    async def test_execute_unknown_tool(self):
        """Unknown tool name returns error."""
        result = await execute_tool("nonexistent_tool", {})
        assert "Error" in result or "Unknown" in result

    @pytest.mark.asyncio
    async def test_execute_read_file(self, tmp_path):
        """Dispatcher routes to read_file correctly."""
        f = tmp_path / "test.txt"
        f.write_text("dispatched")
        result = await execute_tool("read_file", {"path": str(f)})
        assert result == "dispatched"
