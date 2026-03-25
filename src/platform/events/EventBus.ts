export type EventMap = object;
export type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus<TEvents extends EventMap = EventMap> {
  private listeners = new Map<keyof TEvents, Set<EventHandler<any>>>();

  on<TKey extends keyof TEvents>(eventName: TKey, handler: EventHandler<TEvents[TKey]>): () => void {
    const current = this.listeners.get(eventName) ?? new Set<EventHandler<TEvents[TKey]>>();
    current.add(handler);
    this.listeners.set(eventName, current);

    return () => {
      const listeners = this.listeners.get(eventName);
      if (!listeners) {
        return;
      }

      listeners.delete(handler);
      if (listeners.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  async emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): Promise<void> {
    const listeners = this.listeners.get(eventName);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      await listener(payload);
    }
  }
}
