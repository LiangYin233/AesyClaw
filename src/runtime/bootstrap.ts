import { createApp } from '@/runtime/create-app.js';

const appRuntime = createApp();

export async function bootstrap(): Promise<void> {
  await appRuntime.start();
}

export async function shutdown(): Promise<void> {
  await appRuntime.stop();
}

export function getStatus() {
  return appRuntime.getStatus();
}
