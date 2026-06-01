import { describe, expect, it } from 'vitest';
import { parseSource } from '../../../extensions/plugin_multimodal/media-utils';

describe('parseSource', () => {
  it('parses data URIs', () => {
    const result = parseSource('data:image/png;base64,iVBORw0KGgo=');
    expect(result).toEqual({
      type: 'data',
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    });
  });

  it('parses HTTP URLs', () => {
    const result = parseSource('https://example.com/image.png');
    expect(result).toEqual({ type: 'url', url: 'https://example.com/image.png' });
  });

  it('parses HTTP URLs without www', () => {
    const result = parseSource('http://cdn.test/file.jpg');
    expect(result).toEqual({ type: 'url', url: 'http://cdn.test/file.jpg' });
  });

  it('parses file:// paths', () => {
    const result = parseSource('file:///home/user/file.txt');
    expect(result).toEqual({ type: 'file', filePath: '/home/user/file.txt' });
  });

  it('parses bare file paths', () => {
    const result = parseSource('/absolute/path/file.txt');
    expect(result).toEqual({ type: 'file', filePath: '/absolute/path/file.txt' });
  });

  it('parses relative file paths', () => {
    const result = parseSource('./relative/path/file.txt');
    expect(result).toEqual({ type: 'file', filePath: './relative/path/file.txt' });
  });

  it('parses Windows-style paths', () => {
    const result = parseSource('C:\\Users\\test\\file.txt');
    expect(result).toEqual({ type: 'file', filePath: 'C:\\Users\\test\\file.txt' });
  });

  it('throws for malformed data URIs', () => {
    expect(() => parseSource('data:not-a-valid-uri')).toThrow('无效的 data URI');
  });

  it('throws for data URIs without base64 part', () => {
    expect(() => parseSource('data:text/plain;base64,')).toThrow('无效的 data URI');
  });
});
