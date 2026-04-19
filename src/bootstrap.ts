import { AppRuntime, type BootstrapOptions } from '@/app-runtime.js';
import { createApp } from '@/create-app.js';

export type { BootstrapOptions } from '@/app-runtime.js';
export { AppRuntime } from '@/app-runtime.js';
export { createApp } from '@/create-app.js';

export const appRuntime = createApp();
export const pluginManager = appRuntime.pluginManager;
export const channelManager = appRuntime.channelManager;

export function getHookRuntime() {
  return appRuntime.getHookRuntime();
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  await appRuntime.start(options);
}

export async function shutdown(): Promise<void> {
  await appRuntime.stop();
}

export function isInitialized(): boolean {
  return appRuntime.isInitialized();
}

export async function restart(options: BootstrapOptions = {}): Promise<void> {
  await appRuntime.restart(options);
}

export function getStatus() {
  return appRuntime.getStatus();
}
