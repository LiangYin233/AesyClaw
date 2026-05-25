/**
 * channel_weixin CDN 模块测试 — AES-128-ECB 加密/解密验证
 */

import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { encryptAesEcb, aesEcbPaddedSize } from '../../../extensions/channel_weixin/cdn';

describe('aesEcbPaddedSize', () => {
  it('小数据对齐到 16 字节', () => {
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(15)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);  // 增加一个完整 padding block
  });

  it('边界值', () => {
    expect(aesEcbPaddedSize(0)).toBe(16);
    expect(aesEcbPaddedSize(17)).toBe(32);
    expect(aesEcbPaddedSize(31)).toBe(32);
    expect(aesEcbPaddedSize(32)).toBe(48);
  });
});

describe('encryptAesEcb', () => {
  function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  it('加密后可以解密还原', () => {
    const key = crypto.randomBytes(16);
    const plaintext = Buffer.from('Hello WeChat!', 'utf-8');
    const ciphertext = encryptAesEcb(plaintext, key);
    const decrypted = decryptAesEcb(ciphertext, key);
    expect(decrypted.toString('utf-8')).toBe('Hello WeChat!');
  });

  it('不同密钥加密结果不同', () => {
    const key1 = crypto.randomBytes(16);
    const key2 = crypto.randomBytes(16);
    const plaintext = Buffer.from('Test data', 'utf-8');
    const c1 = encryptAesEcb(plaintext, key1);
    const c2 = encryptAesEcb(plaintext, key2);
    expect(c1.equals(c2)).toBe(false);
  });

  it('相同密钥相同数据结果一致（AES-ECB 确定性）', () => {
    const key = Buffer.from('0123456789abcdef', 'utf-8'); // 16 bytes
    const plaintext = Buffer.from('Hello WeChat!', 'utf-8');
    const c1 = encryptAesEcb(plaintext, key);
    const c2 = encryptAesEcb(plaintext, key);
    expect(c1.equals(c2)).toBe(true);
  });

  it('密文大小匹配 aesEcbPaddedSize', () => {
    const key = crypto.randomBytes(16);
    const sizes = [1, 15, 16, 100, 1000, 17226]; // 包含了实际文件大小
    for (const size of sizes) {
      const plaintext = crypto.randomBytes(size);
      const ciphertext = encryptAesEcb(plaintext, key);
      expect(ciphertext.length).toBe(aesEcbPaddedSize(size));
    }
  });

  it('hex 密钥编码验证（aes_key 格式）', () => {
    // 验证 aes_key 编码链路：
    // aeskey (hex) → Buffer.from(hex) → base64 → 客户端解析
    const rawKey = crypto.randomBytes(16);
    const keyHex = rawKey.toString('hex');       // 32 hex chars

    // 服务端发送的 aes_key
    const aesKeyInMessage = Buffer.from(keyHex).toString('base64');

    // 客户端解析
    const decoded = Buffer.from(aesKeyInMessage, 'base64');
    expect(decoded.toString('utf-8')).toBe(keyHex);
    const restoredKey = Buffer.from(decoded.toString('utf-8'), 'hex');
    expect(restoredKey.equals(rawKey)).toBe(true);

    // 用原始密钥和还原密钥加密，结果一致
    const plaintext = Buffer.from('test', 'utf-8');
    const c1 = encryptAesEcb(plaintext, rawKey);
    const c2 = encryptAesEcb(plaintext, restoredKey);
    expect(c1.equals(c2)).toBe(true);
  });
});
