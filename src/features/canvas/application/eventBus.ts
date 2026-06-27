import type { CanvasEventBus, CanvasEventMap } from './ports';

export class InMemoryCanvasEventBus implements CanvasEventBus {
  private readonly listeners = new Map<keyof CanvasEventMap, Set<(payload: DynamicValue) => void>>();

  publish<TType extends keyof CanvasEventMap>(
    type: TType,
    payload: CanvasEventMap[TType]
  ): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(payload);
    }
  }

  subscribe<TType extends keyof CanvasEventMap>(
    type: TType,
    handler: (payload: CanvasEventMap[TType]) => void
  ): () => void {
    const handlers = this.listeners.get(type) ?? new Set<(payload: DynamicValue) => void>();
    handlers.add(handler as (payload: DynamicValue) => void);
    this.listeners.set(type, handlers);

    return () => {
      const currentHandlers = this.listeners.get(type);
      if (!currentHandlers) {
        return;
      }

      currentHandlers.delete(handler as (payload: DynamicValue) => void);
      if (currentHandlers.size === 0) {
        this.listeners.delete(type);
      }
    };
  }
}
