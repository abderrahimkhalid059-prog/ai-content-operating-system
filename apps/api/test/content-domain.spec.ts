import { ContentEditorialStatus } from '@ai-content-os/database';
import { describe, expect, it } from 'vitest';
import {
  calculateContentMetrics,
  canTransitionEditorialStatus,
  containsExecutableHtml,
  normalizeContentLabels,
  normalizeContentSlug,
  sanitizeEditorialHtml,
} from '../src/modules/contents/content-domain';

describe('Phase 3A content domain', () => {
  it('normalizes slugs and labels deterministically', () => {
    expect(normalizeContentSlug('  Été à Casablanca — Guide  ')).toBe('ete-a-casablanca-guide');
    expect(normalizeContentSlug('دليل المحتوى الآمن')).toBe('دليل-المحتوى-الامن');
    expect(normalizeContentLabels([' SEO ', 'seo', 'Actualité  Locale'])).toEqual([
      'actualité locale',
      'seo',
    ]);
  });

  it('calculates plain text, Unicode words, and reading time from HTML', () => {
    const result = calculateContentMetrics('<h1>مرحبا بالعالم</h1><p>Bonjour l’été 2026.</p>');
    expect(result.plainTextContent).toBe('مرحبا بالعالم Bonjour l’été 2026.');
    expect(result.wordCount).toBe(5);
    expect(result.estimatedReadingMinutes).toBe(1);
  });

  it('sanitizes editorial markup and hard-rejects executable HTML', () => {
    expect(containsExecutableHtml('<p onclick="steal()">Texte</p>')).toBe(true);
    expect(containsExecutableHtml('<script>alert(1)</script>')).toBe(true);
    expect(sanitizeEditorialHtml('<p class="removed">Texte</p>')).toBe('<p>Texte</p>');
    expect(
      sanitizeEditorialHtml('<a href="https://example.test" target="_blank">Lien</a>'),
    ).toContain('rel="noopener noreferrer"');
  });

  it('enforces the explicit editorial transition graph', () => {
    expect(
      canTransitionEditorialStatus(ContentEditorialStatus.DRAFT, ContentEditorialStatus.IN_REVIEW),
    ).toBe(true);
    expect(
      canTransitionEditorialStatus(ContentEditorialStatus.DRAFT, ContentEditorialStatus.PUBLISHED),
    ).toBe(false);
    expect(
      canTransitionEditorialStatus(
        ContentEditorialStatus.APPROVED,
        ContentEditorialStatus.ARCHIVED,
      ),
    ).toBe(true);
  });
});
