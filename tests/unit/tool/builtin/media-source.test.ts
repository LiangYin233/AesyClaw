import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-media-source');

import { loadMediaSource } from '../../../../src/tool/builtin/media-source';

describe('loadMediaSource', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('local file', () => {
    it('should load a PNG image from disk', async () => {
      const filePath = join(TEST_DIR, 'test.png');
      writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const result = await loadMediaSource(filePath, 'image');
      expect(result.mimeType).toBe('image/png');
      expect(result.fileName).toBe('test.png');
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.base64).toBeTruthy();
    });

    it('should load a JPEG image from disk', async () => {
      const filePath = join(TEST_DIR, 'photo.jpg');
      writeFileSync(filePath, Buffer.from([0xff, 0xd8]));

      const result = await loadMediaSource(filePath, 'image');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.fileName).toBe('photo.jpg');
    });

    it('should load a WAV audio from disk', async () => {
      const filePath = join(TEST_DIR, 'audio.wav');
      writeFileSync(filePath, Buffer.from([0x52, 0x49]));

      const result = await loadMediaSource(filePath, 'audio');
      expect(result.mimeType).toBe('audio/wav');
      expect(result.fileName).toBe('audio.wav');
    });

    it('should load an MP3 audio from disk', async () => {
      const filePath = join(TEST_DIR, 'song.mp3');
      writeFileSync(filePath, Buffer.from([0xff, 0xfb]));

      const result = await loadMediaSource(filePath, 'audio');
      expect(result.mimeType).toBe('audio/mpeg');
      expect(result.fileName).toBe('song.mp3');
    });

    it('should throw when MIME type does not match expected kind', async () => {
      const filePath = join(TEST_DIR, 'disguised.png');
      writeFileSync(filePath, Buffer.from([0x89, 0x50]));

      await expect(loadMediaSource(filePath, 'audio')).rejects.toThrow('Expected an audio source');
    });

    it('should throw when extension is unknown', async () => {
      const filePath = join(TEST_DIR, 'unknown.xyz');
      writeFileSync(filePath, Buffer.from([0x00, 0x01]));

      await expect(loadMediaSource(filePath, 'image')).rejects.toThrow(
        'Could not determine MIME type',
      );
    });
  });

  describe('.jpeg extension', () => {
    it('should infer image/jpeg from .jpeg files', async () => {
      const filePath = join(TEST_DIR, 'photo.jpeg');
      writeFileSync(filePath, Buffer.from([0xff, 0xd8]));

      const result = await loadMediaSource(filePath, 'image');
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('.webp extension', () => {
    it('should infer image/webp from .webp files', async () => {
      const filePath = join(TEST_DIR, 'img.webp');
      writeFileSync(filePath, Buffer.from([0x00, 0x01]));

      const result = await loadMediaSource(filePath, 'image');
      expect(result.mimeType).toBe('image/webp');
    });
  });

  describe('.ogg extension', () => {
    it('should infer audio/ogg from .ogg files', async () => {
      const filePath = join(TEST_DIR, 'sound.ogg');
      writeFileSync(filePath, Buffer.from([0x00, 0x01]));

      const result = await loadMediaSource(filePath, 'audio');
      expect(result.mimeType).toBe('audio/ogg');
    });
  });

  describe('.flac extension', () => {
    it('should infer audio/flac from .flac files', async () => {
      const filePath = join(TEST_DIR, 'lossless.flac');
      writeFileSync(filePath, Buffer.from([0x00, 0x01]));

      const result = await loadMediaSource(filePath, 'audio');
      expect(result.mimeType).toBe('audio/flac');
    });
  });

  describe('remote source', () => {
    it('should load media from a remote URL via fetch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          arrayBuffer: async () => new Uint8Array([0x89, 0x50]).buffer,
        }),
      );

      const result = await loadMediaSource('https://example.com/images/photo.png', 'image');
      expect(result.mimeType).toBe('image/png');
      expect(result.fileName).toBe('photo.png');
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.base64).toBeTruthy();
    });

    it('should throw on non-ok fetch responses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      await expect(loadMediaSource('https://example.com/missing.png', 'image')).rejects.toThrow(
        'Failed to fetch media source (404): Not Found',
      );
    });

    it('should strip content-type charset parameters', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Map([['content-type', 'audio/mpeg; charset=binary']]),
          arrayBuffer: async () => new Uint8Array([0xff]).buffer,
        }),
      );

      const result = await loadMediaSource('https://example.com/song.mp3', 'audio');
      expect(result.mimeType).toBe('audio/mpeg');
    });
  });
});
