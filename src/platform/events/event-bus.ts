import { logger } from '../observability/logger.js';

type EventHandler<T = unknown> = (_payload: T) => void | Promise<void>;

interface EventSubscription {
  id: string;
  handler: EventHandler;
}

export class EventBus {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private subscriptionIdCounter: number = 0;

  on<T = unknown>(event: string, handler: EventHandler<T>): string {
    return this.addSubscription(event, handler as EventHandler<unknown>);
  }

  off(event: string, subscriptionId?: string): void {
    if (subscriptionId) {
      const subs = this.subscriptions.get(event);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscriptionId);
        if (index !== -1) {
          subs.splice(index, 1);
        }
        if (subs.length === 0) {
          this.subscriptions.delete(event);
        }
      }
    } else {
      this.subscriptions.delete(event);
    }
  }

  emit<T = unknown>(event: string, payload?: T): void {
    const subs = this.subscriptions.get(event);
    if (!subs || subs.length === 0) return;

    for (const sub of subs) {
      try {
        const result = sub.handler(payload as T);
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error(
              { error, event, handlerName: sub.handler.name || 'anonymous' },
              'Event handler error'
            );
          });
        }
      } catch (error) {
        logger.error(
          { error, event, handlerName: sub.handler.name || 'anonymous' },
          'Event handler error'
        );
      }
    }
  }

  private addSubscription(event: string, handler: EventHandler): string {
    const id = `sub_${++this.subscriptionIdCounter}`;

    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, []);
    }

    this.subscriptions.get(event)!.push({
      id,
      handler: handler as EventHandler,
    });

    return id;
  }
}

export const eventBus = new EventBus();

export const SystemEvents = {
  CRON_JOB_CREATED: 'cron:job:created',
  CRON_JOB_UPDATED: 'cron:job:updated',
  CRON_JOB_DELETED: 'cron:job:deleted',
  CRON_JOB_TOGGLED: 'cron:job:toggled',
  CRON_JOB_EXECUTED: 'cron:job:executed',
} as const;

export type SystemEvent = typeof SystemEvents[keyof typeof SystemEvents];
