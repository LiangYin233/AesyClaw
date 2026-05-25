/** channel_weixin/monitor — 长轮询消息接收循环 */

import { getUpdates, type WeixinMessage, type WeixinApiOptions } from './api';

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };

export type MonitorCallbacks = {
  onMessage: (fromUserId: string, content: string, msg: WeixinMessage) => void;
  onError: (err: string) => void;
};

/**
 * 启动长轮询监控循环。
 * 返回 stop 函数用于终止循环。
 */
export function startMonitor(
  apiOpts: WeixinApiOptions,
  callbacks: MonitorCallbacks,
  logger: Logger,
  getUpdatesBuf?: string,
): { stop: () => void; getUpdatesBuf: () => string } {
  let aborted = false;
  let buf = getUpdatesBuf ?? '';
  let consecutiveFailures = 0;
  let timeoutMs = 35_000;

  const loop = async (): Promise<void> => {
    while (!aborted) {
      try {
        const resp = await getUpdates({
          baseUrl: apiOpts.baseUrl,
          token: apiOpts.token,
          get_updates_buf: buf,
          timeoutMs,
        });

        consecutiveFailures = 0;

        if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
          timeoutMs = resp.longpolling_timeout_ms;
        }

        if (resp.get_updates_buf) {
          buf = resp.get_updates_buf;
        }

        if (resp.msgs) {
          for (const msg of resp.msgs) {
            const fromUserId = msg.from_user_id;
            const content = extractText(msg);
            if (fromUserId && content) {
              callbacks.onMessage(fromUserId, content, msg);
            }
          }
        }
      } catch (err) {
        if (aborted) return;
        consecutiveFailures++;
        logger.error(`长轮询错误: ${err}`);
        if (consecutiveFailures >= 3) {
          callbacks.onError(`连续 ${consecutiveFailures} 次轮询失败`);
          await sleep(30_000);
          consecutiveFailures = 0;
        } else {
          await sleep(2000);
        }
      }
    }
  };

  // 后台执行
  void loop();

  return {
    stop: () => {
      aborted = true;
    },
    getUpdatesBuf: () => buf,
  };
}

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list) return '';

  // 优先取 TEXT 类型的消息内容，没有则取任意第一个非空内容
  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      return item.text_item.text;
    }
  }
  for (const item of msg.item_list) {
    const text = item.text_item?.text;
    if (text) return text;
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
