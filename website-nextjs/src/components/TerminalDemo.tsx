"use client";

import { useEffect, useState } from "react";

export default function TerminalDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => {
        if (prev >= 14) {
          // Reset after a long pause
          setTimeout(() => setStep(0), 3000);
          return prev;
        }
        return prev + 1;
      });
    }, 900);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#0D0D0F] border border-border-primary rounded-xl p-5 md:p-6 max-w-[580px] mx-auto mb-8 font-mono text-[13px] leading-[1.8] font-normal text-left shadow-2xl">
      <div className="font-sans text-[11px] text-text-muted mb-3 font-semibold uppercase tracking-wider">
        terminal
      </div>
      <div className="text-text-primary mb-3">
        <span className="text-text-secondary">$ </span>
        <span>mmcp auto "Add JWT auth to this Express app"</span>
      </div>

      <div className="space-y-1 relative">
        <div
          className={`transition-all duration-300 relative pl-4 ${
            step >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
          } ${step >= 4 ? "text-text-secondary" : "text-text-primary"}`}
        >
          {step >= 4 && (
            <div className="absolute left-[-14px] top-[8px] w-1.5 h-1.5 rounded-full bg-deepseek" />
          )}
          {step < 4 && (
            <span className="text-deepseek mr-2 animate-pulse-opacity">●</span>
          )}
          <span className={step < 4 ? "text-deepseek" : ""}>
            {step >= 4 ? (
              <>
                <span className="text-green-500 mr-2">✓</span>
                Analyzed codebase · 4 files · 3 endpoints
              </>
            ) : (
              "Planning..."
            )}
          </span>
          {step < 4 && (
            <span className="ml-2 font-semibold text-[11px] px-1.5 py-0.5 rounded text-deepseek bg-deepseek/15">
              DeepSeek R1
            </span>
          )}
        </div>

        <div
          className={`transition-all duration-300 relative pl-4 ${
            step >= 5 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none absolute"
          } ${step >= 7 ? "text-text-secondary" : "text-text-primary"}`}
        >
          {step >= 7 && (
            <div className="absolute left-[-14px] top-[8px] w-1.5 h-1.5 rounded-full bg-gemini" />
          )}
          {step < 7 && (
            <span className="text-gemini mr-2 animate-pulse-opacity">●</span>
          )}
          <span className={step < 7 ? "text-gemini" : ""}>
            {step >= 7 ? (
              <>
                <span className="text-green-500 mr-2">✓</span>
                auth.ts <span className="text-green-500">+86 lines</span> · middleware.ts <span className="text-green-500">+12 lines</span>
              </>
            ) : (
              "Implementing..."
            )}
          </span>
          {step < 7 && (
            <span className="ml-2 font-semibold text-[11px] px-1.5 py-0.5 rounded text-gemini bg-gemini/15">
              Gemini 2.5 Pro
            </span>
          )}
        </div>

        <div
          className={`transition-all duration-300 relative pl-4 ${
            step >= 8 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none absolute"
          } ${step >= 10 ? "text-text-secondary" : "text-text-primary"}`}
        >
          {step >= 10 && (
            <div className="absolute left-[-14px] top-[8px] w-1.5 h-1.5 rounded-full bg-claude" />
          )}
          {step < 10 && (
            <span className="text-claude mr-2 animate-pulse-opacity">●</span>
          )}
          <span className={step < 10 ? "text-claude" : ""}>
            {step >= 10 ? (
              <>
                <span className="text-green-500 mr-2">✓</span>
                No security issues · JWT best practices followed
              </>
            ) : (
              "Reviewing..."
            )}
          </span>
          {step < 10 && (
            <span className="ml-2 font-semibold text-[11px] px-1.5 py-0.5 rounded text-claude bg-claude/15">
              Claude Sonnet
            </span>
          )}
        </div>

        <div
          className={`transition-all duration-300 relative pl-4 ${
            step >= 11 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none absolute"
          } ${step >= 13 ? "text-text-secondary" : "text-text-primary"}`}
        >
          {step >= 13 && (
            <div className="absolute left-[-14px] top-[8px] w-1.5 h-1.5 rounded-full bg-gemini" />
          )}
          {step < 13 && (
            <span className="text-gemini mr-2 animate-pulse-opacity">●</span>
          )}
          <span className={step < 13 ? "text-gemini" : ""}>
            {step >= 13 ? (
              <>
                <span className="text-green-500 mr-2">✓</span>
                8 tests generated · all passing
              </>
            ) : (
              "Testing..."
            )}
          </span>
          {step < 13 && (
            <span className="ml-2 font-semibold text-[11px] px-1.5 py-0.5 rounded text-gemini bg-gemini/15">
              Gemini 2.5 Pro
            </span>
          )}
        </div>

        <div
          className={`transition-all duration-300 relative pl-4 pt-2 ${
            step >= 14 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none absolute"
          }`}
        >
          <span className="text-[15px] mr-2">✅</span>
          <span className="text-text-primary font-semibold">Complete</span>
          <span className="text-text-secondary mx-2">·</span>
          <span className="text-text-secondary">4 steps</span>
          <span className="text-text-secondary mx-2">·</span>
          <span className="text-text-secondary">4 models</span>
          <span className="text-text-secondary mx-2">·</span>
          <span className="text-green-500">$0.02</span>
          <span className="text-text-secondary mx-2">·</span>
          <span className="text-text-secondary">22s</span>
        </div>
      </div>
    </div>
  );
}
