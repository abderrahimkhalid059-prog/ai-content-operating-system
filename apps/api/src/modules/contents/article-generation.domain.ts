import type { AiArticleDraft } from '@ai-content-os/contracts';
import { parseStructuredOutput } from '@ai-content-os/integrations';
import {
  containsExecutableHtml,
  MAX_CONTENT_HTML_BYTES,
  MAX_CONTENT_LABEL_LENGTH,
  MAX_CONTENT_LABELS,
  normalizeContentLabels,
  normalizeContentSlug,
  sanitizeEditorialHtml,
} from './content-domain';

const allowedKeys = new Set([
  'title',
  'excerpt',
  'bodyHtml',
  'suggestedSlug',
  'metaDescription',
  'suggestedLabels',
  'warnings',
]);

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw new Error('Expected a string.');
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error('Invalid string length.');
  return normalized;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, maxLength);
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid string array.');
  return value.map((entry) => requiredString(entry, maxLength));
}

export function parseArticleDraft(text: string): AiArticleDraft {
  return parseStructuredOutput(text, {
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an object.');
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new Error('Unexpected generated field.');
      }
      const title = requiredString(record.title, 300);
      const rawHtml = requiredString(record.bodyHtml, MAX_CONTENT_HTML_BYTES);
      if (
        Buffer.byteLength(rawHtml, 'utf8') > MAX_CONTENT_HTML_BYTES ||
        containsExecutableHtml(rawHtml)
      ) {
        throw new Error('Unsafe generated HTML.');
      }
      const bodyHtml = sanitizeEditorialHtml(rawHtml);
      if (!bodyHtml.trim()) throw new Error('Generated body is empty.');
      const suggestedSlugValue = optionalString(record.suggestedSlug, 120);
      const suggestedSlug = suggestedSlugValue
        ? normalizeContentSlug(suggestedSlugValue)
        : undefined;
      if (suggestedSlugValue && !suggestedSlug) throw new Error('Invalid generated slug.');
      const suggestedLabels = normalizeContentLabels(
        stringArray(record.suggestedLabels, MAX_CONTENT_LABELS, MAX_CONTENT_LABEL_LENGTH),
      );
      const excerpt = optionalString(record.excerpt, 1000);
      const metaDescription = optionalString(record.metaDescription, 180);
      return {
        title,
        ...(excerpt ? { excerpt } : {}),
        bodyHtml,
        ...(suggestedSlug ? { suggestedSlug } : {}),
        ...(metaDescription ? { metaDescription } : {}),
        suggestedLabels,
        warnings: stringArray(record.warnings, 10, 500),
      };
    },
  });
}
