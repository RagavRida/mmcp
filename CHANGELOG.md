# Changelog

All notable changes to `@mmcp/core` will be documented in this file.

## v1.0.0

- Stable wire format with SHA-256 audit hashes
- Cross-vendor adapters: Anthropic, OpenAI, OpenRouter, Google
- MMCP Registry + 4 built-in pipelines
- Compliance suite (55 tests, 7 groups)
- Cost breakdown per node and vendor
- Cycle detection in DAG validation
- Failed node → downstream "skipped" propagation
- Full 128-bit UUID context IDs
- Shared context event observability (`mmcp.shared.write` / `mmcp.shared.read`)

## v0.3.0

- Skill Registry with 14 pre-registered skills and 3 Claude model profiles
- SkillAwareRouter — auto-assigns models by capability match
- `forkBySkill()` and `verifyWithSkills()` operations
- Routing strategies: `best_match`, `cheapest`, `cost_optimized`
- `skill_report` in `MMCPRunResult`

## v0.2.0

- SharedContextStore — append-only, parallel-safe key-value store
- Full audit trail with author, timestamp, version per entry
- `snapshot()`, `history()`, `diff(since)` query methods
- Auto-injection of shared context into model system prompts

## v0.1.0

- Core DAG protocol — `fork`, `merge`, `handoff`, `shard`, `verify`
- `ContextEnvelope` with `parent_ids[]` (DAG not tree)
- `MemoryStore`, `RoleBasedRouter`, `MMCPObserver`
- Topological execution with parallel dispatch
- TypeScript SDK with full type safety
