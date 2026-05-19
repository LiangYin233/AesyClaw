import { describe, expect, it } from 'vitest';

import { makeSessionTitle, stripInformationTags } from '../../../desktop/src/renderer/utils/title';

describe('desktop title utilities', () => {
  it('strips information and misspelled infomation blocks from titles', () => {
    expect(makeSessionTitle('<information>hidden</information>Visible title', 'fallback')).toBe(
      'Visible title',
    );
    expect(makeSessionTitle('<infomation>hidden</infomation>Visible title', 'fallback')).toBe(
      'Visible title',
    );
  });

  it('strips metadata blocks from message history without collapsing normal whitespace', () => {
    expect(
      stripInformationTags('before\n<infomation>hidden</infomation>\n```ts\nconst x = 1;\n```'),
    ).toBe('before\n\n```ts\nconst x = 1;\n```');
  });
});
