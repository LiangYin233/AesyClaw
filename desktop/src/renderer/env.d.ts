/** API 类型声明 — 使渲染进程可以类型安全地访问 preload 暴露的 API */

import type { AesyClawApi } from '../preload/index';

declare global {
  interface Window {
    aesyclaw: AesyClawApi;
  }
}

export {};
