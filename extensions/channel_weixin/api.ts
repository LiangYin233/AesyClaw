/** channel_weixin/api — iLink HTTP API 客户端 */

import crypto from 'node:crypto';

// ─── 常量 ──────────────────────────────────────────────────────────

/** 二维码/登录等请求的固定 base URL */
export const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;

// ─── 类型 ──────────────────────────────────────────────────────────

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
};

export type GetUpdatesResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export type WeixinMessage = {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
};

export type MessageItem = {
  type?: number;
  text_item?: { text?: string };
  image_item?: Record<string, unknown>;
  voice_item?: Record<string, unknown>;
  file_item?: Record<string, unknown>;
  video_item?: Record<string, unknown>;
  ref_msg?: Record<string, unknown>;
};

export type QRCodeResponse = {
  qrcode: string;
  qrcode_img_content: string;
};

export type QRStatusResponse = {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'need_verifycode' | 'verify_code_blocked' | 'scaned_but_redirect' | 'binded_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
};

// ─── 通用请求头 ────────────────────────────────────────────────────

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token?.trim()) h["Authorization"] = `Bearer ${token.trim()}`;
  return h;
}

// ─── HTTP 请求 ─────────────────────────────────────────────────────

async function apiPost(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  token?: string,
  timeoutMs?: number,
): Promise<string> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── API 函数 ──────────────────────────────────────────────────────

/** 通知服务端频道启动 */
export async function notifyStart(opts: WeixinApiOptions): Promise<void> {
  await apiPost(opts.baseUrl, 'ilink/bot/msg/notifystart', {}, opts.token, DEFAULT_API_TIMEOUT_MS);
}

/** 长轮询获取消息 */
export async function getUpdates(
  opts: WeixinApiOptions & { get_updates_buf?: string; timeoutMs?: number; abortSignal?: AbortSignal },
): Promise<GetUpdatesResp> {
  try {
    const text = await apiPost(
      opts.baseUrl,
      'ilink/bot/getupdates',
      { get_updates_buf: opts.get_updates_buf ?? '', base_info: {} },
      opts.token,
      opts.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    );
    return JSON.parse(text) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (opts.abortSignal?.aborted) return { ret: 0, msgs: [], get_updates_buf: opts.get_updates_buf };
      return { ret: 0, msgs: [], get_updates_buf: opts.get_updates_buf };
    }
    throw err;
  }
}

/** 发送消息 */
export async function sendMessage(
  opts: WeixinApiOptions & { body: Record<string, unknown> },
): Promise<void> {
  await apiPost(opts.baseUrl, 'ilink/bot/sendmessage', opts.body, opts.token, DEFAULT_API_TIMEOUT_MS);
}

/** 获取 CDN 上传预签名 URL */
export async function getUploadUrl(
  opts: WeixinApiOptions & {
    filekey: string; media_type: number; to_user_id: string;
    rawsize: number; rawfilemd5: string; filesize: number;
    aeskey: string; no_need_thumb?: boolean;
  },
): Promise<{ upload_param?: string; upload_full_url?: string }> {
  const text = await apiPost(opts.baseUrl, 'ilink/bot/getuploadurl', opts, opts.token, DEFAULT_API_TIMEOUT_MS);
  return JSON.parse(text);
}

/** 获取账号配置（typing_ticket） */
export async function getConfig(
  opts: WeixinApiOptions & { ilink_user_id: string; context_token?: string },
): Promise<{ ret?: number; typing_ticket?: string }> {
  const text = await apiPost(
    opts.baseUrl, 'ilink/bot/getconfig',
    { ilink_user_id: opts.ilink_user_id, context_token: opts.context_token, base_info: {} },
    opts.token, DEFAULT_API_TIMEOUT_MS,
  );
  return JSON.parse(text);
}

/** 发送输入状态 */
export async function sendTyping(
  opts: WeixinApiOptions & { ilink_user_id: string; typing_ticket?: string; status?: number },
): Promise<void> {
  await apiPost(opts.baseUrl, 'ilink/bot/sendtyping', opts, opts.token, DEFAULT_API_TIMEOUT_MS);
}

/** 通知服务端频道停止 */
export async function notifyStop(opts: WeixinApiOptions): Promise<void> {
  await apiPost(opts.baseUrl, 'ilink/bot/msg/notifystop', {}, opts.token, DEFAULT_API_TIMEOUT_MS);
}

// ─── 登录相关 API ──────────────────────────────────────────────────

/** 获取登录二维码 */
export async function fetchQRCode(botType = '3'): Promise<QRCodeResponse> {
  const text = await apiPost(
    FIXED_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    {},
    undefined,
    DEFAULT_API_TIMEOUT_MS,
  );
  return JSON.parse(text);
}

/** 轮询二维码状态 */
export async function pollQRStatus(qrcode: string, verifyCode?: string): Promise<QRStatusResponse> {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    const url = new URL(endpoint, FIXED_BASE_URL);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const headers: Record<string, string> = {
        'iLink-App-Id': 'aesyclaw',
        'X-WECHAT-UIN': randomWechatUin(),
      };
      const res = await fetch(url.toString(), { headers, signal: controller.signal });
      const raw = await res.text();
      return JSON.parse(raw) as QRStatusResponse;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { status: 'wait' };
    return { status: 'wait' };
  }
}
