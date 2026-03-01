"""
MMCP Router — mirrors TypeScript src/routing/router.ts exactly.
"""
from __future__ import annotations
from .types import ContextEnvelope, ModelAssignment


class RoleBasedRouter:
    def __init__(
        self,
        roles: dict[str, dict],
        default_config: dict | None = None,
    ) -> None:
        self.roles = roles
        self.default_config = default_config or {
            "model_id": "claude-sonnet-4-20250514",
            "endpoint": "https://api.anthropic.com/v1/messages",
        }

    def route(self, context: ContextEnvelope) -> ModelAssignment:
        config = self.roles.get(context.role, self.default_config)
        return ModelAssignment(
            model_id=config.get("model_id", "claude-sonnet-4-20250514"),
            endpoint=config.get(
                "endpoint", "https://api.anthropic.com/v1/messages"
            ),
            api_key=config.get("api_key"),
            system_prompt=config.get("system_prompt")
            or self._default_prompt(context),
            max_tokens=config.get("max_tokens", 1000),
            temperature=config.get("temperature", 0.7),
        )

    def _default_prompt(self, ctx: ContextEnvelope) -> str:
        return (
            f"You are the {ctx.role.upper()} agent in an MMCP pipeline.\n"
            f"Branch type: {ctx.branch_type}. Task: {ctx.task}.\n"
            f"Be concise and stay in your assigned role."
        )
