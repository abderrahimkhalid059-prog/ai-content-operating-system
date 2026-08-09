import sanitizeHtml from 'sanitize-html';
import { ContentEditorialStatus } from '@ai-content-os/database';

export const READING_WORDS_PER_MINUTE = 225;
export const MAX_CONTENT_HTML_BYTES = 500_000;
export const MAX_CONTENT_LABELS = 30;
export const MAX_CONTENT_LABEL_LENGTH = 80;

export const ALLOWED_EDITORIAL_TRANSITIONS: Readonly<
  Record<ContentEditorialStatus, readonly ContentEditorialStatus[]>
> = {
  IDEA: [ContentEditorialStatus.RESEARCHING, ContentEditorialStatus.DRAFT],
  RESEARCHING: [ContentEditorialStatus.OUTLINED, ContentEditorialStatus.DRAFT],
  OUTLINED: [ContentEditorialStatus.DRAFT],
  DRAFT: [ContentEditorialStatus.IN_REVIEW],
  IN_REVIEW: [ContentEditorialStatus.CHANGES_REQUESTED, ContentEditorialStatus.APPROVED],
  CHANGES_REQUESTED: [ContentEditorialStatus.DRAFT],
  APPROVED: [ContentEditorialStatus.READY_TO_PUBLISH],
  READY_TO_PUBLISH: [ContentEditorialStatus.PUBLISHED],
  PUBLISHED: [],
  ARCHIVED: [],
};

const executableHtml =
  /<\s*(?:script|iframe|object|embed|svg|math)\b|\son[a-z]+\s*=|(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i;

export function containsExecutableHtml(html: string): boolean {
  return executableHtml.test(html);
}

export function sanitizeEditorialHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'caption',
      'code',
      'pre',
      'hr',
      'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      span: ['lang'],
      '*': ['dir'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: {
          ...attributes,
          ...(attributes['target'] === '_blank' ? { rel: 'noopener noreferrer' } : {}),
        },
      }),
    },
  }).trim();
}

export function plainTextFromHtml(html: string): string {
  const spacedBlocks = html.replace(
    /<\s*\/?\s*(?:p|h[1-6]|li|blockquote|tr|td|th|br|hr)\b[^>]*>/gi,
    ' ',
  );
  return sanitizeHtml(spacedBlocks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateContentMetrics(html: string): {
  plainTextContent: string;
  wordCount: number;
  estimatedReadingMinutes: number;
} {
  const plainTextContent = plainTextFromHtml(html);
  const wordCount = plainTextContent.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return {
    plainTextContent,
    wordCount,
    estimatedReadingMinutes: wordCount === 0 ? 0 : Math.ceil(wordCount / READING_WORDS_PER_MINUTE),
  };
}

export function normalizeContentSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    .replace(/-$/g, '');
}

export function normalizeContentLabels(labels: readonly string[]): string[] {
  const normalized = labels.map((label) =>
    label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und'),
  );
  return [...new Set(normalized.filter(Boolean))].sort();
}

export function canTransitionEditorialStatus(
  current: ContentEditorialStatus,
  next: ContentEditorialStatus,
): boolean {
  return (
    (next === ContentEditorialStatus.ARCHIVED && current !== ContentEditorialStatus.ARCHIVED) ||
    ALLOWED_EDITORIAL_TRANSITIONS[current].includes(next)
  );
}
