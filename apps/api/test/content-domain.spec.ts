import type { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
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
import { parseArticleDraft } from '../src/modules/contents/article-generation.domain';
import { AiProviderFactory } from '../src/modules/ai/ai-provider.factory';

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

describe('Phase 4B controlled article draft domain', () => {
  it('renders article.draft@1 deterministically from generic website and profile context', () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService<EnvironmentConfig, true>;
    const prompts = new AiProviderFactory(config).prompts;
    const variables = {
      website: 'Site générique',
      websiteLanguage: 'fr',
      websiteLocale: 'fr-FR',
      profile: 'Profil générique',
      profileLanguage: 'fr',
      profileLocale: 'fr-FR',
      tone: 'Clair',
      defaultAudience: 'Public général',
      editorialRules: '{}',
      prohibitedTopics: '[]',
      topic: 'Sujet générique',
      angle: 'Angle explicite',
      requestedAudience: 'Lecteurs',
      instructions: 'Aucune recherche externe',
      approximateLength: '500 mots environ',
      currentTitle: 'Titre actuel',
    };
    const first = prompts.render('article.draft', 1, variables);
    expect(prompts.render('article.draft', 1, variables)).toEqual(first);
    expect(first).toMatchObject({ identifier: 'article.draft', version: 1 });
    expect(first.userPrompt).toContain('Website=Site générique');
    expect(first.userPrompt).toContain('Profile=Profil générique');
    const missingTopic = { ...variables } as Partial<typeof variables>;
    delete missingTopic.topic;
    expect(() => prompts.render('article.draft', 1, missingTopic)).toThrow(
      'Missing prompt variables',
    );
  });

  it('accepts, normalizes, and sanitizes the strict article schema', () => {
    const draft = parseArticleDraft(
      JSON.stringify({
        title: ' Brouillon sûr ',
        excerpt: 'Résumé',
        bodyHtml: '<h2 class="removed">Titre</h2><p>Texte sûr.</p>',
        suggestedSlug: 'Été éditorial',
        metaDescription: 'Description',
        suggestedLabels: [' IA ', 'ia', 'Validation'],
        warnings: ['Relire les faits.'],
      }),
    );
    expect(draft).toMatchObject({
      title: 'Brouillon sûr',
      bodyHtml: '<h2>Titre</h2><p>Texte sûr.</p>',
      suggestedSlug: 'ete-editorial',
      suggestedLabels: ['ia', 'validation'],
    });
  });

  it.each([
    '{not-json',
    JSON.stringify({ title: 'Titre', bodyHtml: '<script>alert(1)</script>' }),
    JSON.stringify({ title: 'Titre', bodyHtml: '<p>Sûr</p>', unexpected: true }),
  ])('rejects malformed, executable, or non-allowlisted output', (value) => {
    expect(() => parseArticleDraft(value)).toThrowError(
      expect.objectContaining({ code: 'AI_MALFORMED_RESPONSE', retryable: false }),
    );
  });
});
