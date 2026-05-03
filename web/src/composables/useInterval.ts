import { onUnmounted } from 'vue';

export function useInterval(callback: () => void, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    stop();
    timer = setInterval(callback, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onUnmounted(() => {
    stop();
  });

  return { start, stop };
}
