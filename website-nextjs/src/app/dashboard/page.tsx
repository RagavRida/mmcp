"use client";

import { useState } from "react";

// ── Mock Pipeline Data ─────────────────────────────────────────────────────
// In production, this would come from the ContextEngine API

type NodeStatus = "done" | "failed" | "running" | "pending" | "skipped";

interface DagNode {
  id: string;
  role: string;
  model: string;
  vendor: string;
  status: NodeStatus;
  branch_type: string;
  parent_ids: string[];
  tokens_used: number;
  cost_usd: number;
  latency_ms: number;
  confidence: number;
  output_preview: string;
  state: string;
  routing_reason: string;
}

interface PipelineRun {
  id: string;
  name: string;
  task: string;
  created_at: string;
  duration_ms: number;
  total_tokens: number;
  total_cost_usd: number;
  success: boolean;
  nodes: DagNode[];
}

const MOCK_RUNS: PipelineRun[] = [
  {
    id: "run_001",
    name: "Legal Contract Review",
    task: "Review the SaaS agreement for liability clauses, IP ownership, and GDPR compliance",
    created_at: "2026-03-18T20:15:00Z",
    duration_ms: 8420,
    total_tokens: 12847,
    total_cost_usd: 0.0238,
    success: true,
    nodes: [
      {
        id: "ctx_a1", role: "analyst", model: "claude-sonnet-4-20250514", vendor: "anthropic",
        status: "done", branch_type: "root", parent_ids: [], tokens_used: 3200,
        cost_usd: 0.0096, latency_ms: 2100, confidence: 0.94,
        output_preview: "Identified 3 critical liability clauses in sections 4.2, 7.1, and 9.3...",
        state: "DONE", routing_reason: "Best match (score: 0.92) — reasoning + data_extraction skills",
      },
      {
        id: "ctx_b1", role: "security_analyst", model: "gpt-4o", vendor: "openai",
        status: "done", branch_type: "fork", parent_ids: ["ctx_a1"], tokens_used: 2800,
        cost_usd: 0.007, latency_ms: 1800, confidence: 0.89,
        output_preview: "GDPR Article 28 compliance gap found: no sub-processor notification clause...",
        state: "DONE", routing_reason: "Cost optimized (simple task): picked cheapest with security_analysis skill",
      },
      {
        id: "ctx_b2", role: "IP_analyst", model: "claude-haiku-4-5-20251001", vendor: "anthropic",
        status: "done", branch_type: "fork", parent_ids: ["ctx_a1"], tokens_used: 1500,
        cost_usd: 0.0019, latency_ms: 900, confidence: 0.91,
        output_preview: "IP ownership is retained by licensor per section 5.1. Work product...",
        state: "DONE", routing_reason: "Cheapest model with all required skills (score: 0.88)",
      },
      {
        id: "ctx_c1", role: "challenger", model: "claude-sonnet-4-20250514", vendor: "anthropic",
        status: "done", branch_type: "verify", parent_ids: ["ctx_b1"], tokens_used: 2200,
        cost_usd: 0.0033, latency_ms: 1600, confidence: 0.87,
        output_preview: "Challenge: The GDPR gap analysis missed Article 32 security measures...",
        state: "DONE", routing_reason: "Verification requires fact_checking + reasoning — best match",
      },
      {
        id: "ctx_d1", role: "synthesizer", model: "claude-sonnet-4-20250514", vendor: "anthropic",
        status: "done", branch_type: "merge", parent_ids: ["ctx_b1", "ctx_b2", "ctx_c1"], tokens_used: 3147,
        cost_usd: 0.002, latency_ms: 2020, confidence: 0.93,
        output_preview: "Final synthesis: The agreement has 3 high-risk areas requiring amendment...",
        state: "DONE", routing_reason: "Merge node — needs summarization + reasoning (full match)",
      },
    ],
  },
  {
    id: "run_002",
    name: "Code Review Pipeline",
    task: "Review the authentication module for security vulnerabilities and performance issues",
    created_at: "2026-03-18T19:45:00Z",
    duration_ms: 5200,
    total_tokens: 8900,
    total_cost_usd: 0.0145,
    success: false,
    nodes: [
      {
        id: "ctx_x1", role: "architect", model: "claude-sonnet-4-20250514", vendor: "anthropic",
        status: "done", branch_type: "root", parent_ids: [], tokens_used: 2500,
        cost_usd: 0.005, latency_ms: 1500, confidence: 0.91,
        output_preview: "Architecture analysis: JWT implementation uses HS256, recommend RS256...",
        state: "DONE", routing_reason: "Best match (score: 0.95) — planning + code_review",
      },
      {
        id: "ctx_x2", role: "security_analyst", model: "gpt-4o", vendor: "openai",
        status: "failed", branch_type: "fork", parent_ids: ["ctx_x1"], tokens_used: 1200,
        cost_usd: 0.003, latency_ms: 3200, confidence: 0,
        output_preview: "Error: API rate limit exceeded after 2 retries",
        state: "FAILED", routing_reason: "Cost optimized — openai selected for security_analysis",
      },
      {
        id: "ctx_x3", role: "perf_analyst", model: "claude-haiku-4-5-20251001", vendor: "anthropic",
        status: "done", branch_type: "fork", parent_ids: ["ctx_x1"], tokens_used: 1800,
        cost_usd: 0.0015, latency_ms: 800, confidence: 0.88,
        output_preview: "Performance: Token refresh endpoint has O(n) lookup, recommend indexing...",
        state: "DONE", routing_reason: "Cheapest model — simple performance review task",
      },
      {
        id: "ctx_x4", role: "summarizer", model: "claude-haiku-4-5-20251001", vendor: "anthropic",
        status: "skipped", branch_type: "merge", parent_ids: ["ctx_x2", "ctx_x3"], tokens_used: 0,
        cost_usd: 0, latency_ms: 0, confidence: 0,
        output_preview: "Skipped: upstream node ctx_x2 (security_analyst) failed",
        state: "FAILED", routing_reason: "N/A — skipped due to upstream failure",
      },
    ],
  },
];

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: NodeStatus }) {
  const styles: Record<NodeStatus, string> = {
    done: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    skipped: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${styles[status]}`}>
      {status}
    </span>
  );
}

// ── Vendor Badge ─────────────────────────────────────────────────────────────

function VendorBadge({ vendor }: { vendor: string }) {
  const colors: Record<string, string> = {
    anthropic: "text-claude",
    openai: "text-gpt4o",
    google: "text-gemini",
    openrouter: "text-deepseek",
  };
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider ${colors[vendor] ?? "text-text-muted"}`}>
      {vendor}
    </span>
  );
}

// ── DAG Visualization ────────────────────────────────────────────────────────

function DagGraph({ nodes }: { nodes: DagNode[] }) {
  const statusColors: Record<NodeStatus, string> = {
    done: "#10B981",
    failed: "#EF4444",
    running: "#3B82F6",
    pending: "#71717A",
    skipped: "#F59E0B",
  };

  // Simple layered layout
  const layers: DagNode[][] = [];
  const placed = new Set<string>();

  // Layer 0: roots
  const roots = nodes.filter(n => n.parent_ids.length === 0);
  if (roots.length > 0) {
    layers.push(roots);
    roots.forEach(n => placed.add(n.id));
  }

  // Keep layering until all placed
  while (placed.size < nodes.length) {
    const nextLayer = nodes.filter(
      n => !placed.has(n.id) && n.parent_ids.every(pid => placed.has(pid))
    );
    if (nextLayer.length === 0) break;
    layers.push(nextLayer);
    nextLayer.forEach(n => placed.add(n.id));
  }

  const NODE_W = 160;
  const NODE_H = 56;
  const X_GAP = 40;
  const Y_GAP = 28;

  const totalHeight = layers.length * (NODE_H + Y_GAP);
  const maxWidth = Math.max(...layers.map(l => l.length)) * (NODE_W + X_GAP);

  // Assign positions
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, li) => {
    const layerWidth = layer.length * NODE_W + (layer.length - 1) * X_GAP;
    const startX = (maxWidth - layerWidth) / 2;
    layer.forEach((node, ni) => {
      positions.set(node.id, {
        x: startX + ni * (NODE_W + X_GAP),
        y: li * (NODE_H + Y_GAP),
      });
    });
  });

  return (
    <div className="overflow-x-auto py-4">
      <svg
        width={maxWidth + 40}
        height={totalHeight + 20}
        viewBox={`-20 -10 ${maxWidth + 40} ${totalHeight + 20}`}
        className="mx-auto"
      >
        {/* Edges */}
        {nodes.map(node =>
          node.parent_ids.map(pid => {
            const from = positions.get(pid);
            const to = positions.get(node.id);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;
            return (
              <path
                key={`${pid}-${node.id}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke={node.status === "failed" || node.status === "skipped" ? "#EF4444" : "#3F3F46"}
                strokeWidth="1.5"
                strokeDasharray={node.status === "skipped" ? "4,4" : "none"}
                opacity={0.6}
              />
            );
          })
        )}
        {/* Nodes */}
        {nodes.map(node => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const color = statusColors[node.status];
          return (
            <g key={node.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="#111113"
                stroke={color}
                strokeWidth={node.status === "failed" ? 2 : 1}
                opacity={node.status === "skipped" ? 0.4 : 1}
              />
              <text
                x={pos.x + 12}
                y={pos.y + 20}
                fill="#FAFAFA"
                fontSize={11}
                fontFamily="Inter, sans-serif"
                fontWeight={600}
              >
                {node.role}
              </text>
              <text
                x={pos.x + 12}
                y={pos.y + 38}
                fill="#71717A"
                fontSize={9}
                fontFamily="JetBrains Mono, monospace"
              >
                {node.model.length > 20 ? node.model.slice(0, 18) + "…" : node.model}
              </text>
              {/* Status dot */}
              <circle
                cx={pos.x + NODE_W - 14}
                cy={pos.y + 14}
                r={4}
                fill={color}
              >
                {node.status === "running" && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
                )}
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Cost Bar ─────────────────────────────────────────────────────────────────

function CostBar({ nodes }: { nodes: DagNode[] }) {
  const maxCost = Math.max(...nodes.map(n => n.cost_usd), 0.001);
  const vendorColors: Record<string, string> = {
    anthropic: "#A855F7",
    openai: "#14B8A6",
    google: "#4285F4",
  };

  return (
    <div className="space-y-2">
      {nodes.filter(n => n.cost_usd > 0).map(node => (
        <div key={node.id} className="flex items-center gap-3">
          <div className="w-24 text-[11px] text-text-muted font-mono truncate">{node.role}</div>
          <div className="flex-1 h-5 bg-bg-page rounded-md overflow-hidden relative">
            <div
              className="h-full rounded-md transition-all duration-700"
              style={{
                width: `${Math.max((node.cost_usd / maxCost) * 100, 4)}%`,
                backgroundColor: vendorColors[node.vendor] ?? "#71717A",
                opacity: node.status === "failed" ? 0.4 : 0.8,
              }}
            />
            <span className="absolute right-2 top-0.5 text-[10px] text-text-muted font-mono">
              ${node.cost_usd.toFixed(4)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Latency Bar ──────────────────────────────────────────────────────────────

function LatencyBar({ nodes }: { nodes: DagNode[] }) {
  const maxLatency = Math.max(...nodes.map(n => n.latency_ms), 100);

  return (
    <div className="space-y-2">
      {nodes.filter(n => n.latency_ms > 0).map(node => (
        <div key={node.id} className="flex items-center gap-3">
          <div className="w-24 text-[11px] text-text-muted font-mono truncate">{node.role}</div>
          <div className="flex-1 h-5 bg-bg-page rounded-md overflow-hidden relative">
            <div
              className="h-full rounded-md transition-all duration-700"
              style={{
                width: `${Math.max((node.latency_ms / maxLatency) * 100, 4)}%`,
                backgroundColor: node.latency_ms > 3000 ? "#EF4444" : node.latency_ms > 1500 ? "#F59E0B" : "#10B981",
                opacity: 0.7,
              }}
            />
            <span className="absolute right-2 top-0.5 text-[10px] text-text-muted font-mono">
              {(node.latency_ms / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const [selectedRun, setSelectedRun] = useState<PipelineRun>(MOCK_RUNS[0]);
  const [selectedNode, setSelectedNode] = useState<DagNode | null>(null);

  const successRate = MOCK_RUNS.filter(r => r.success).length / MOCK_RUNS.length;

  return (
    <div className="min-h-screen bg-bg-page">
      {/* Header */}
      <header className="sticky top-0 z-50 h-[52px] bg-bg-surface border-b border-border-primary/50 flex items-center justify-between px-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-[15px] text-text-primary tracking-tight">mmcp</span>
          <span className="text-[11px] text-text-muted font-mono bg-bg-elevated px-2 py-0.5 rounded">dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className={`inline-block w-2 h-2 rounded-full ${successRate >= 0.8 ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="text-text-muted">{Math.round(successRate * 100)}% success</span>
          </div>
          <span className="text-[11px] text-text-muted font-mono">{MOCK_RUNS.length} runs</span>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-6">

        {/* Stat Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Runs" value={MOCK_RUNS.length.toString()} />
          <StatCard
            label="Total Cost"
            value={`$${MOCK_RUNS.reduce((s, r) => s + r.total_cost_usd, 0).toFixed(4)}`}
          />
          <StatCard
            label="Avg Latency"
            value={`${(MOCK_RUNS.reduce((s, r) => s + r.duration_ms, 0) / MOCK_RUNS.length / 1000).toFixed(1)}s`}
          />
          <StatCard
            label="Total Tokens"
            value={MOCK_RUNS.reduce((s, r) => s + r.total_tokens, 0).toLocaleString()}
          />
        </div>

        {/* Run Selector */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {MOCK_RUNS.map(run => (
            <button
              key={run.id}
              onClick={() => { setSelectedRun(run); setSelectedNode(null); }}
              className={`flex-shrink-0 px-4 py-2.5 rounded-lg border text-left transition-all ${
                selectedRun.id === run.id
                  ? "border-gemini bg-gemini/10 shadow-[0_0_20px_rgba(66,133,244,0.1)]"
                  : "border-border-primary bg-bg-surface hover:border-border-hover"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${run.success ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-[13px] font-semibold text-text-primary">{run.name}</span>
              </div>
              <div className="text-[11px] text-text-muted font-mono">
                {run.nodes.length} nodes · ${run.total_cost_usd.toFixed(4)} · {(run.duration_ms / 1000).toFixed(1)}s
              </div>
            </button>
          ))}
        </div>

        {/* DAG Section */}
        <div className="bg-bg-surface border border-border-primary rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-text-primary">Pipeline DAG</h2>
              <p className="text-[11px] text-text-muted mt-0.5">Click a node to inspect</p>
            </div>
            <div className="flex gap-3 text-[10px] text-text-muted">
              {(["done", "failed", "skipped"] as NodeStatus[]).map(s => (
                <div key={s} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${
                    s === "done" ? "bg-emerald-500" : s === "failed" ? "bg-red-500" : "bg-amber-500"
                  }`} />
                  {s}
                </div>
              ))}
            </div>
          </div>
          <DagGraph nodes={selectedRun.nodes} />
        </div>

        {/* Detail Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Cost Breakdown */}
          <div className="bg-bg-surface border border-border-primary rounded-xl p-5">
            <h3 className="text-[13px] font-semibold text-text-primary mb-4">💰 Cost per Step</h3>
            <CostBar nodes={selectedRun.nodes} />
            <div className="mt-3 pt-3 border-t border-border-primary flex justify-between text-[11px]">
              <span className="text-text-muted">Total</span>
              <span className="text-text-primary font-mono font-semibold">${selectedRun.total_cost_usd.toFixed(4)}</span>
            </div>
          </div>

          {/* Latency Breakdown */}
          <div className="bg-bg-surface border border-border-primary rounded-xl p-5">
            <h3 className="text-[13px] font-semibold text-text-primary mb-4">⚡ Latency per Step</h3>
            <LatencyBar nodes={selectedRun.nodes} />
            <div className="mt-3 pt-3 border-t border-border-primary flex justify-between text-[11px]">
              <span className="text-text-muted">Total pipeline</span>
              <span className="text-text-primary font-mono font-semibold">{(selectedRun.duration_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>

        {/* Node Details Table */}
        <div className="bg-bg-surface border border-border-primary rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-primary">
            <h3 className="text-[13px] font-semibold text-text-primary">🧠 Model Routing Decisions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border-primary bg-bg-elevated/50">
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Role</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Model</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Vendor</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">State</th>
                  <th className="text-left px-4 py-2.5 text-text-muted font-medium">Routing Reason</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.nodes.map(node => (
                  <tr
                    key={node.id}
                    className={`border-b border-border-primary/50 cursor-pointer transition-colors ${
                      selectedNode?.id === node.id ? "bg-gemini/5" : "hover:bg-bg-elevated/50"
                    }`}
                    onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-text-primary">{node.role}</td>
                    <td className="px-4 py-3 font-mono text-text-secondary">
                      {node.model.length > 25 ? node.model.slice(0, 23) + "…" : node.model}
                    </td>
                    <td className="px-4 py-3"><VendorBadge vendor={node.vendor} /></td>
                    <td className="px-4 py-3"><StatusBadge status={node.status} /></td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[10px] text-text-muted bg-bg-page px-1.5 py-0.5 rounded">
                        {node.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted max-w-[300px] truncate">{node.routing_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Node Detail */}
        {selectedNode && (
          <div className="bg-bg-surface border border-gemini/30 rounded-xl p-5 shadow-[0_0_30px_rgba(66,133,244,0.08)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-[15px] font-semibold text-text-primary">{selectedNode.role}</h3>
                <StatusBadge status={selectedNode.status} />
                <VendorBadge vendor={selectedNode.vendor} />
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-text-muted hover:text-text-primary text-[13px] transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MiniStat label="Model" value={selectedNode.model} mono />
              <MiniStat label="Tokens" value={selectedNode.tokens_used.toLocaleString()} />
              <MiniStat label="Cost" value={`$${selectedNode.cost_usd.toFixed(4)}`} />
              <MiniStat label="Latency" value={`${(selectedNode.latency_ms / 1000).toFixed(1)}s`} />
            </div>

            <div className="mb-3">
              <div className="text-[11px] text-text-muted mb-1 uppercase tracking-wider font-medium">Routing Reason</div>
              <div className="text-[12px] text-text-secondary bg-bg-page rounded-md px-3 py-2 font-mono">
                {selectedNode.routing_reason}
              </div>
            </div>

            <div className="mb-3">
              <div className="text-[11px] text-text-muted mb-1 uppercase tracking-wider font-medium">
                Confidence: {(selectedNode.confidence * 100).toFixed(0)}%
              </div>
              <div className="h-1.5 bg-bg-page rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${selectedNode.confidence * 100}%`,
                    backgroundColor: selectedNode.confidence > 0.8 ? "#10B981" : selectedNode.confidence > 0.5 ? "#F59E0B" : "#EF4444",
                  }}
                />
              </div>
            </div>

            <div>
              <div className="text-[11px] text-text-muted mb-1 uppercase tracking-wider font-medium">Output Preview</div>
              <div className="text-[12px] text-text-secondary bg-bg-page rounded-md px-3 py-2 leading-relaxed">
                {selectedNode.output_preview}
              </div>
            </div>
          </div>
        )}

        {/* Failure Points */}
        {selectedRun.nodes.some(n => n.status === "failed" || n.status === "skipped") && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
            <h3 className="text-[13px] font-semibold text-red-400 mb-3">⚠️ Failure Points</h3>
            <div className="space-y-2">
              {selectedRun.nodes
                .filter(n => n.status === "failed" || n.status === "skipped")
                .map(node => (
                  <div key={node.id} className="flex items-start gap-3 text-[12px]">
                    <StatusBadge status={node.status} />
                    <div>
                      <span className="text-text-primary font-semibold">{node.role}</span>
                      <span className="text-text-muted"> ({node.model})</span>
                      <div className="text-text-muted mt-0.5">{node.output_preview}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable Components ──────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-surface border border-border-primary rounded-xl px-4 py-3.5">
      <div className="text-[11px] text-text-muted uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className="text-[20px] font-semibold text-text-primary font-mono">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-bg-page rounded-lg px-3 py-2">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-[12px] text-text-primary mt-0.5 ${mono ? "font-mono" : "font-semibold"} truncate`}>{value}</div>
    </div>
  );
}
