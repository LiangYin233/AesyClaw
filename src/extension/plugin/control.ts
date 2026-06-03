/**
 * plugin/control — 插件可用的运行时控制面接口。
 *
 * 该接口为 plugin_webui 等运行时服务插件提供实时管理能力，同时避免
 * 直接暴露内部 manager。请求分发复用现有 WebUI WebSocket 协议。
 */

import type { WebRuntimeDependencies } from '@aesyclaw/web/types';
import type { WsMessage, WsResponse } from '@aesyclaw/web/ws/types';
import { dispatchMessage } from '@aesyclaw/web/ws/dispatcher';

export type RuntimeControlRequest = Pick<WsMessage, 'type' | 'requestId' | 'data'>;

export type RuntimeControlEventMap = {
  'runtime:ready': undefined;
  'runtime:reset': undefined;
  'config:reloaded': undefined;
};

export type RuntimeControlEvent = keyof RuntimeControlEventMap;
export type RuntimeControlEventHandler<T extends RuntimeControlEvent = RuntimeControlEvent> = (
  payload: RuntimeControlEventMap[T],
) => void;

export type RuntimeControlApi = {
  /** 当前控制面依赖是否已经绑定完成。 */
  isReady(): boolean;
  /** 等待控制面依赖绑定完成。 */
  waitUntilReady(): Promise<void>;
  /** 通过标准 WebUI 管理协议实时分发请求。 */
  dispatch(request: RuntimeControlRequest): Promise<WsResponse>;
  /** 订阅控制面事件，返回取消订阅函数。 */
  on<T extends RuntimeControlEvent>(event: T, handler: RuntimeControlEventHandler<T>): () => void;
};

export class RuntimeControlHub implements RuntimeControlApi {
  private deps?: WebRuntimeDependencies;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private readonly handlers = new Map<RuntimeControlEvent, Set<RuntimeControlEventHandler>>();

  constructor() {
    this.readyPromise = this.createReadyPromise();
  }

  isReady(): boolean {
    return this.deps !== undefined;
  }

  async waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }

  bind(deps: WebRuntimeDependencies): void {
    this.deps = deps;
    this.resolveReady();
    this.emit('runtime:ready', undefined);
  }

  reset(): void {
    this.deps = undefined;
    this.readyPromise = this.createReadyPromise();
    this.emit('runtime:reset', undefined);
  }

  notifyConfigReloaded(): void {
    this.emit('config:reloaded', undefined);
  }

  async dispatch(request: RuntimeControlRequest): Promise<WsResponse> {
    await this.waitUntilReady();
    if (this.deps === undefined) {
      return {
        type: request.type,
        requestId: request.requestId,
        ok: false,
        error: 'Runtime control services are not ready',
      };
    }
    return await dispatchMessage(request, this.deps);
  }

  on<T extends RuntimeControlEvent>(event: T, handler: RuntimeControlEventHandler<T>): () => void {
    const set = this.handlers.get(event) ?? new Set<RuntimeControlEventHandler>();
    set.add(handler as RuntimeControlEventHandler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as RuntimeControlEventHandler);
      if (set.size === 0) this.handlers.delete(event);
    };
  }

  private emit<T extends RuntimeControlEvent>(
    event: T,
    payload: RuntimeControlEventMap[T],
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      handler(payload);
    }
  }

  private createReadyPromise(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }
}
