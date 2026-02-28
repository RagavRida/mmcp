import { MMCPEvent, MMCPEventType, MMCPEventHandler } from "../core/types";

export class MMCPObserver {
  private handlers: MMCPEventHandler[] = [];

  on(handler: MMCPEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: MMCPEventHandler): void {
    this.handlers = this.handlers.filter(h => h !== handler);
  }

  emit(type: MMCPEventType, data: Record<string, unknown>, context_id?: string): void {
    const event: MMCPEvent = {
      type,
      timestamp: new Date().toISOString(),
      context_id,
      data,
    };
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* handlers must not throw */ }
    }
  }

  // Convenience: log all events to console
  enableConsoleLogging(prefix = "[MMCP]"): void {
    this.on((event) => {
      const id = event.context_id ? ` ${event.context_id}` : "";
      console.log(`${prefix} ${event.type}${id}`, event.data);
    });
  }
}
