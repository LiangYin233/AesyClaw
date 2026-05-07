/** 异步互斥锁 — 确保异步操作按顺序执行。 */
export class AsyncMutex {
  private queue: Array<() => Promise<void>> = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const run = async (): Promise<void> => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.locked = false;
          this.dequeue();
        }
      };

      if (this.locked) {
        this.queue.push(run);
      } else {
        this.locked = true;
        void run();
      }
    });
  }

  private dequeue(): void {
    const next = this.queue.shift();
    if (next) {
      this.locked = true;
      void next();
    }
  }
}
