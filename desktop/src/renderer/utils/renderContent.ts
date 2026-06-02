import DOMPurify from 'dompurify';
import { marked } from 'marked';

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
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
  });
  return addSafeLinkAttributes(clean);
}

function addSafeLinkAttributes(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const anchor of template.content.querySelectorAll('a')) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noreferrer noopener');
  }
  return template.innerHTML;
}
