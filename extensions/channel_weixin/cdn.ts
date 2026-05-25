/** channel_weixin/cdn — AES-128-ECB 加密与 CDN 上传 */

import crypto from 'node:crypto';
import { getUploadUrl } from './api';

/** AES-128-ECB 加密（PKCS7 padding） */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** AES-128-ECB 密文大小（PKCS7 对齐到 16 字节） */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

export type UploadedFileInfo = {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskey: string; // hex
  fileSize: number; // 明文大小
  fileSizeCiphertext: number; // 密文大小
};

/**
 * 上传文件到微信 CDN：
 * 1. 生成 AES-128 密钥
 * 2. 计算 MD5 和大小
 * 3. getUploadUrl 获取预签名 URL
 * 4. AES 加密后 PUT 到 CDN
 */
export async function uploadToCdn(
  fileBuffer: Buffer,
  toUserId: string,
  mediaType: number,
  opts: { baseUrl: string; token: string },
): Promise<UploadedFileInfo> {
  const rawsize = fileBuffer.length;
  const rawfilemd5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString('hex');
  const aeskey = crypto.randomBytes(16);

  const uploadResp = await getUploadUrl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
  });

  const uploadFullUrl = uploadResp.upload_full_url?.trim();
  const uploadParam = uploadResp.upload_param;
  if (!uploadFullUrl && !uploadParam) {
    throw new Error('getUploadUrl 未返回上传 URL');
  }

  const cdnUrl =
    uploadFullUrl ||
    `${opts.baseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam!)}&filekey=${encodeURIComponent(filekey)}`;

  // AES-128-ECB 加密
  const ciphertext = encryptAesEcb(fileBuffer, aeskey);

  // PUT 到 CDN
  const res = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(ciphertext),
  });

  if (!res.ok) {
    throw new Error(`CDN 上传失败 (${res.status}): ${await res.text().catch(() => '')}`);
  }

  const downloadParam = res.headers.get('x-encrypted-param');
  if (!downloadParam) {
    throw new Error('CDN 响应缺少 x-encrypted-param header');
  }

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString('hex'),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}
