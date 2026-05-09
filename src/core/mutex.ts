/** 异步互斥锁 — 确保异步操作按顺序执行。 */
export class AsyncMutex {
  private queue: Array<() => Promise<void>> = [];
  private locked = false;

  /**
   * 在互斥锁保护下执行异步操作，确保同一时刻只有一个操作在执行。
   *
   * @param fn - 需要互斥执行的操作函数
   * @returns 操作函数的返回值
   */
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
