import Link from "next/link";
import TerminalDemo from "@/components/TerminalDemo";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 h-[52px] bg-bg-surface border-b border-border-primary/50 flex items-center justify-between px-6 md:px-8 backdrop-blur-md">
        <div className="font-semibold text-[15px] text-text-primary tracking-tight">mmcp</div>
        <div className="hidden md:flex items-center gap-6">
          <Link href="/dashboard" className="text-[13px] text-text-secondary hover:text-text-primary transition-colors">Dashboard</Link>
          <Link href="#" className="text-[13px] text-text-secondary hover:text-text-primary transition-colors">Docs</Link>
          <Link href="https://github.com/RagavRida/mmcp" className="text-[13px] text-text-secondary hover:text-text-primary transition-colors">GitHub</Link>
          <Link href="#pricing" className="text-[13px] text-text-secondary hover:text-text-primary transition-colors">Pricing</Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-[13px] px-3.5 py-1.5 rounded-md border border-border-hover text-text-primary hover:bg-bg-elevated transition-colors">
            Sign in
          </button>
          <button className="text-[13px] px-3.5 py-1.5 rounded-md bg-text-primary text-bg-page font-semibold hover:bg-zinc-200 transition-colors">
            Start free
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="bg-bg-page pt-20 pb-16 px-6 text-center">
        <div className="max-w-[800px] mx-auto">
          <div className="text-[11px] font-semibold tracking-widest text-text-muted uppercase mb-5">
            Open protocol · Dual SDK · 8 models
          </div>
          <h1 className="text-4xl md:text-[52px] font-semibold text-text-primary leading-[1.15] mb-4">
            One command.<br className="hidden md:block" /> Any AI task. Done.
          </h1>
          <p className="text-[15px] text-text-secondary max-w-[520px] mx-auto mb-9 leading-[1.6]">
            MMCP writes the pipeline, picks the right model for each step, uses any tool, and executes — start to finish. No config. No stitching. Just results.
          </p>

          <TerminalDemo />

          <div className="flex items-center justify-center gap-3">
            <button className="text-[13px] px-5 py-2 rounded-md border border-border-hover text-text-primary hover:bg-bg-elevated hover:border-text-muted transition-colors font-mono">
              pip install mmcp-core ↗
            </button>
            <button className="text-[13px] font-semibold px-5 py-2 rounded-md bg-text-primary text-bg-page hover:bg-zinc-200 transition-colors">
              See it run live ↗
            </button>
          </div>
        </div>
      </section>

      {/* Social Proof Strip */}
      <section className="border-y border-border-primary bg-bg-surface py-5 px-6 flex justify-center gap-12 flex-wrap">
        <div className="flex flex-col items-center">
          <div className="text-lg font-semibold text-text-primary">8</div>
          <div className="text-[11px] text-text-muted mt-1 uppercase tracking-wide font-medium">AI models</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-lg font-semibold text-text-primary">PyPI + npm</div>
          <div className="text-[11px] text-text-muted mt-1 uppercase tracking-wide font-medium">Dual SDK</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-lg font-semibold text-text-primary">30 sec</div>
          <div className="text-[11px] text-text-muted mt-1 uppercase tracking-wide font-medium">Setup time</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-lg font-semibold text-text-primary">MIT</div>
          <div className="text-[11px] text-text-muted mt-1 uppercase tracking-wide font-medium">Open source</div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="bg-bg-page py-16 px-6">
        <div className="text-center mb-8">
          <h2 className="text-[22px] font-semibold text-text-primary">Simple pricing</h2>
          <p className="text-[13px] text-text-muted mt-1.5">Pay only for what you use. 15% markup on token costs.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-[860px] mx-auto">
          {/* Free Tier */}
          <div className="bg-bg-surface border border-border-primary rounded-xl p-6 transition-colors hover:border-border-hover">
            <div className="text-[13px] text-text-secondary">Free</div>
            <div className="text-[32px] font-semibold text-text-primary my-2">$0</div>
            <div className="text-[12px] text-text-muted mb-4">forever</div>
            
            <ul className="text-[12px] text-text-secondary leading-loose mb-5 space-y-1">
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> 50 runs / month</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> All 8 models</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Skill cache</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Community MCP servers</li>
            </ul>
            
            <button className="w-full py-2 rounded-md text-[13px] border border-border-hover text-text-primary hover:bg-bg-elevated transition-colors">
              Install the extension
            </button>
          </div>

          {/* Pro Tier (Featured) */}
          <div className="bg-bg-surface border-2 border-gemini rounded-xl p-6 relative">
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#1D3B6E] text-gemini text-[11px] font-semibold px-3 py-0.5 rounded-md whitespace-nowrap">
              Most popular
            </div>
            <div className="text-[13px] text-text-secondary">Pro</div>
            <div className="text-[32px] font-semibold text-text-primary my-2">$29<span className="text-[14px] text-text-muted font-normal">/mo</span></div>
            <div className="text-[12px] text-text-muted mb-4">for individual developers</div>
            
            <ul className="text-[12px] text-text-secondary leading-loose mb-5 space-y-1">
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Unlimited runs</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Priority model routing</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Premium MCP servers</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Audit trail export</li>
            </ul>
            
            <button className="w-full py-2 rounded-md text-[13px] font-semibold bg-gemini text-white hover:bg-[#3B77DB] transition-colors">
              Start free trial
            </button>
          </div>

          {/* Team Tier */}
          <div className="bg-bg-surface border border-border-primary rounded-xl p-6 transition-colors hover:border-border-hover">
            <div className="text-[13px] text-text-secondary">Team</div>
            <div className="text-[32px] font-semibold text-text-primary my-2">$79<span className="text-[14px] text-text-muted font-normal">/seat</span></div>
            <div className="text-[12px] text-text-muted mb-4">per month</div>
            
            <ul className="text-[12px] text-text-secondary leading-loose mb-5 space-y-1">
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Unlimited runs</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Shared skill library</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Team audit logs</li>
              <li className="flex items-center"><span className="text-green-500 mr-2">✓</span> Private MCP servers</li>
            </ul>
            
            <button className="w-full py-2 rounded-md text-[13px] border border-border-hover text-text-primary hover:bg-bg-elevated transition-colors">
              Start team trial
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
