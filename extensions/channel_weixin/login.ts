/** channel_weixin/login — 微信扫码登录流程 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchQRCode, pollQRStatus } from './api';

export type LoginResult = {
  success: boolean;
  message: string;
  token?: string;
  baseUrl?: string;
  accountId?: string;
  userId?: string;
  qrImagePath?: string;
};

const MAX_QR_REFRESH = 3;

/**
 * 获取二维码并保存到文件，返回二维码信息和轮询函数。
 */
export async function prepareQR(mediaDir: string): Promise<{
  qrCode: string;
  qrImagePath: string;
  message: string;
}> {
  const qrResp = await fetchQRCode('3');
  if (!qrResp.qrcode || !qrResp.qrcode_img_content) {
    throw new Error('获取二维码失败：响应数据不完整');
  }

  const qrDir = path.join(mediaDir, 'weixin');
  await fs.mkdir(qrDir, { recursive: true });
  const qrFileName = `qrcode-${Date.now()}.png`;
  const qrFilePath = path.join(qrDir, qrFileName);

  try {
    const imgRes = await fetch(qrResp.qrcode_img_content);
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      await fs.writeFile(qrFilePath, buf);
    }
  } catch {
    await fs.writeFile(qrFilePath.replace('.png', '.url.txt'), qrResp.qrcode_img_content);
  }

  return {
    qrCode: qrResp.qrcode,
    qrImagePath: qrFilePath,
    message: `请扫描二维码完成登录：文件路径: ${qrFilePath}`,
  };
}

/**
 * 轮询二维码状态，直到扫码确认或超时。
 */
export async function pollLogin(
  qrCode: string,
  timeoutMs = 480_000,
  onStatus?: (status: string) => void,
): Promise<LoginResult> {
  const deadline = Date.now() + timeoutMs;
  let qrRefreshCount = 0;

  while (Date.now() < deadline) {
    const resp = await pollQRStatus(qrCode);
    onStatus?.(resp.status);

    switch (resp.status) {
      case 'wait':
      case 'scaned':
        await sleep(1000);
        break;

      case 'confirmed':
        return {
          success: true,
          message: '微信登录成功',
          token: resp.bot_token,
          baseUrl: resp.baseurl,
          accountId: resp.ilink_bot_id,
          userId: resp.ilink_user_id,
        };

      case 'binded_redirect':
        return {
          success: true,
          message: '该微信已绑定到此账号，无需重复登录',
          token: '',
          baseUrl: '',
        };

      case 'expired': {
        qrRefreshCount++;
        if (qrRefreshCount > MAX_QR_REFRESH)
          return { success: false, message: '二维码多次过期，请重试' };
        const qr = await fetchQRCode('3');
        qrCode = qr.qrcode;
        await sleep(1000);
        break;
      }

      case 'need_verifycode':
        onStatus?.('need_verifycode');
        await sleep(3000);
        break;

      case 'verify_code_blocked':
        return { success: false, message: '配对码输入错误次数过多，请稍后重试' };

      case 'scaned_but_redirect':
        await sleep(1000);
        break;
    }
  }

  return { success: false, message: '登录超时，请重试' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
