const INFORMATION_TAG_RE = /<info(?:r)?mation\b[^>]*>[\s\S]*?<\/info(?:r)?mation>/gi;

export function stripInformationTags(text: string): string {
  return text.replace(INFORMATION_TAG_RE, '');
}

export function makeSessionTitle(text: string, fallback: string): string {
  const cleaned = stripInformationTags(text).replace(/\s+/g, ' ').trim();
  const source = cleaned.length > 0 ? cleaned : fallback;
  return source.slice(0, 30) + (source.length > 30 ? '…' : '');
}
