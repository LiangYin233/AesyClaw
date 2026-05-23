import { marked } from 'marked';

const URI_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'poster']);
const SAFE_URI_RE = /^(?:(?:https?|mailto|tel):|[/?#]|\.\.?\/)/i;

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
});

export function renderMarkdownSafe(source: string | null | undefined): string {
  if (!source) return '';
  const html = marked.parse(source) as string;
  return sanitizeHtml(html);
}

function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(root: ParentNode): void {
  const nodes = [...root.querySelectorAll('*')];
  for (const node of nodes) {
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (
      tag === 'script' ||
      tag === 'iframe' ||
      tag === 'object' ||
      tag === 'embed' ||
      tag === 'link' ||
      tag === 'meta' ||
      tag === 'base'
    ) {
      element.remove();
      continue;
    }

    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (name === 'srcdoc') {
        element.removeAttribute(attr.name);
        continue;
      }

      if (URI_ATTRS.has(name) && !isSafeUri(value)) {
        element.removeAttribute(attr.name);
      }
    }

    if (tag === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer noopener');
    }
  }
}

function isSafeUri(value: string): boolean {
  if (value === '') return true;
  return SAFE_URI_RE.test(value);
}
