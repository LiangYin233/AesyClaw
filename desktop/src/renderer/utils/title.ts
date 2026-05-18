const INFORMATION_TAG_RE = /<information\b[^>]*>[\s\S]*?<\/information>/gi;

export function stripInformationTags(text: string): string {
  return text.replace(INFORMATION_TAG_RE, '').replace(/\s+/g, ' ').trim();
}

export function makeSessionTitle(text: string, fallback: string): string {
  const cleaned = stripInformationTags(text);
  const source = cleaned.length > 0 ? cleaned : fallback;
  return source.slice(0, 30) + (source.length > 30 ? '…' : '');
}
