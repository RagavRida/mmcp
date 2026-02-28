/**
 * MMCP Examples — run with: ts-node examples/usage.ts
 * Uses mock adapter (no API key required)
 */

import {
  MMCPOrchestrator, RoleBasedRouter, MemoryStore, MMCPObserver,
  fork, merge, handoff, shard, verify,
} from "../src/index";
import { MemoryStore as MS } from "../src/store/memory";

// ── Shared setup ──────────────────────────────────────────────────────────────

const router = new RoleBasedRouter({
  architect:   { model_id: "claude-opus-4-20250514",   system_prompt: "You are the ARCHITECT. Break tasks into clear subtasks." },
  coder:       { model_id: "claude-sonnet-4-20250514", system_prompt: "You are the CODER. Write clean, minimal code." },
  verifier:    { model_id: "claude-sonnet-4-20250514", system_prompt: "You are the VERIFIER. Find bugs and issues." },
  reasoner:    { model_id: "claude-sonnet-4-20250514", system_prompt: "You are the REASONER. Analyze deeply." },
  summarizer:  { model_id: "claude-haiku-4-5-20251001",system_prompt: "You are the SUMMARIZER. Be concise." },
  challenger:  { model_id: "claude-sonnet-4-20250514", system_prompt: "You are the CHALLENGER. Be critical and find flaws." },
  synthesizer: { model_id: "claude-sonnet-4-20250514", system_prompt: "You are the SYNTHESIZER. Produce the final balanced answer." },
  orchestrator:{ model_id: "claude-haiku-4-5-20251001",system_prompt: "You are the ORCHESTRATOR." },
});

const observer = new MMCPObserver();
observer.enableConsoleLogging();

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 1: Context Specialization (chain)
// architect → coder → verifier
// ─────────────────────────────────────────────────────────────────────────────

async function example1_specialization() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" EXAMPLE 1: Context Specialization (Chain)");
  console.log("═══════════════════════════════════════════════════\n");

  const store = new MemoryStore();
  const orc = new MMCPOrchestrator({ router, store, adapter: "mock", observer });

  const result = await orc.runChain(
    "Build a REST API for a todo app with JWT authentication",
    ["architect", "coder", "verifier"]
  );

  console.log("\n✅ Final output:", result.output.slice(0, 200));
  console.log(`\n📊 Stats: ${result.total_nodes} nodes | ${result.total_tokens} tokens | ${result.duration_ms}ms`);
  (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 2: Parallel Execution (fork → merge)
// ─────────────────────────────────────────────────────────────────────────────

async function example2_parallel() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" EXAMPLE 2: Parallel Execution (Fork → Merge)");
  console.log("═══════════════════════════════════════════════════\n");

  const store = new MemoryStore();
  const orc = new MMCPOrchestrator({ router, store, adapter: "mock", observer });

  const result = await orc.runParallel(
    "Analyze the pros and cons of microservices architecture",
    ["reasoner", "coder"],
    "summarizer"
  );

  console.log("\n✅ Merged output:", result.output.slice(0, 200));
  (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 3: Context Overflow (Sharding)
// ─────────────────────────────────────────────────────────────────────────────

async function example3_sharding() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" EXAMPLE 3: Context Overflow (Sharding)");
  console.log("═══════════════════════════════════════════════════\n");

  const store = new MemoryStore();
  const orc = new MMCPOrchestrator({ router, store, adapter: "mock", observer });

  const result = await orc.runSharded(
    "Summarize the complete history of the internet from 1960 to 2025",
    "summarizer",
    3,
    "synthesizer"
  );

  console.log("\n✅ Synthesized output:", result.output.slice(0, 200));
  (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 4: Trust & Verification
// ─────────────────────────────────────────────────────────────────────────────

async function example4_verify() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" EXAMPLE 4: Trust & Verification Contract");
  console.log("═══════════════════════════════════════════════════\n");

  const store = new MemoryStore();
  const orc = new MMCPOrchestrator({ router, store, adapter: "mock", observer });

  const result = await orc.runVerify(
    "Is recursion always slower than iteration in Python?",
    "architect",
    "challenger",
    "synthesizer"
  );

  console.log("\n✅ Verified output:", result.output.slice(0, 200));

  // Show the DAG structure
  const dag = result.dag;
  const synthNode = dag.find(c => c.role === "synthesizer");
  console.log(`\n🔗 Synthesizer has ${synthNode?.parent_ids.length} parents (DAG confirmed)`);
  (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 5: Custom DAG — full manual construction
// ─────────────────────────────────────────────────────────────────────────────

async function example5_custom_dag() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" EXAMPLE 5: Custom DAG (Manual Construction)");
  console.log("═══════════════════════════════════════════════════\n");

  const store = new MemoryStore();
  const orc = new MMCPOrchestrator({ router, store, adapter: "mock", observer });

  // Build: architect → [frontend, backend] → verifier → summarizer
  const root = orc.root("Build a full-stack SaaS dashboard", "architect");
  const [frontend, backend] = fork(root, [{ role: "coder" }, { role: "reasoner" }]);
  const ver = merge([frontend, backend], { role: "verifier" });
  const final = handoff(ver, { role: "summarizer" });

  const result = await orc.execute([root, frontend, backend, ver, final]);

  console.log("\n✅ Final output:", result.output.slice(0, 200));
  console.log(`\n📊 ${result.total_nodes} nodes | ${result.total_tokens} tokens | success: ${result.success}`);
  (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all examples
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  await example1_specialization();
  await example2_parallel();
  await example3_sharding();
  await example4_verify();
  await example5_custom_dag();
})();
