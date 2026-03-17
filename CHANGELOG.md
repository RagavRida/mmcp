# Changelog

## [1.1.0] — 2026-03-17

### Added
- **Autonomous Mode** (`mmcp auto`) — AI plans and executes multi-step tasks autonomously
- **Smart Routing** — auto-selects optimal model per task type (coding → Gemini, creative → Claude, math → DeepSeek, fast → Llama)
- **Streaming Executor** — real-time SSE output via `stream_execute()` async generator
- **SSE Streaming Endpoint** — `POST /v1/chat/completions/stream` for cloud server
- **PostgreSQL Support** — dual SQLite/PostgreSQL database layer via `DATABASE_URL`
- **Stripe Integration** — subscription billing (checkout, billing portal, webhooks)
- **Test Suite** — 84 automated tests covering planner, executor, tools, skills
- **GitHub Actions CI/CD** — Python 3.11/3.12/3.13 + Node 18/20 matrix, auto-publish
- **Skill Engine** — save, load, and fuzzy-match reusable pipeline templates
- **Built-in Tools** — web search, file I/O, command execution with allowlist

### Changed
- **CLI Refactor** — split monolithic `cli.py` (1,299 lines) into `cli/` package (7 modules)
- **Cloud Server** bumped to v1.1.0 with Stripe billing endpoints
- **Package** updated with `cloud` optional dependencies

### Fixed
- JSON parsing robustness for LLM responses (handles code fences, control characters)
- Error recovery in executor (retry with fallback models, skip on failure)

## [1.0.0] — 2026-03-01

### Added
- Initial release
- DAG operations: fork, merge, handoff, shard, verify
- CLI with chain, parallel, verify, shard, audit, run commands
- LangGraph tracer integration
- Wire format with SHA-256 audit hashes
- Cloud proxy server with rate limiting
- OpenRouter multi-model support
