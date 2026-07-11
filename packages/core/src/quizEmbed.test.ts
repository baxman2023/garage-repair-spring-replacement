import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderQuizEmbedHtml, type QuizEmbedInputs } from './quizEmbed.js';

const INPUTS: QuizEmbedInputs = {
  slug: 'quiz-fixture',
  apiBase: 'https://app.copyforge.test',
  questions: [
    {
      id: 'q1',
      text: 'What sound does your door make?',
      options: [
        { id: 'q1-a', text: 'A loud bang' },
        { id: 'q1-b', text: 'A slow screech' },
      ],
    },
    {
      id: 'q2',
      text: 'How old is the spring?',
      options: [
        { id: 'q2-a', text: 'Under five years' },
        { id: 'q2-b', text: 'No idea' },
      ],
    },
  ],
  leadCapture: { headline: 'Where should we send your diagnosis?', button: 'Send it', fields: ['email'] },
};

describe('single-file quiz embed (WO-040)', () => {
  it('is fully self-contained: inline CSS/JS, zero external resources', () => {
    const html = renderQuizEmbedHtml(INPUTS);
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    // No external loads: no src/href/url() pointing anywhere.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link\s/);
    expect(html).not.toMatch(/@import|url\(/);
    // The only absolute URL is the API base inside the config JSON.
    const urls = html.match(/https?:\/\/[^"'\s)]+/g) ?? [];
    expect(urls.every((u) => u.startsWith('https://app.copyforge.test'))).toBe(true);
    // Questions embedded — first paint needs no network.
    expect(html).toContain('What sound does your door make?');
    expect(html).toContain('A slow screech');
  });

  it('validates the apiBase origin', () => {
    expect(() => renderQuizEmbedHtml({ ...INPUTS, apiBase: 'not-a-url' })).toThrow(/absolute origin/);
    expect(() => renderQuizEmbedHtml({ ...INPUTS, apiBase: 'https://x.test/path' })).toThrow(/absolute origin/);
  });

  it('runs from file:// — renders, advances one question per screen, reaches lead capture (acceptance)', async () => {
    const html = renderQuizEmbedHtml(INPUTS);
    const dir = await mkdtemp(join(tmpdir(), 'cfq-'));
    const file = join(dir, 'quiz.html');
    await writeFile(file, html, 'utf8');

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    });
    try {
      const page = await browser.newPage({ viewport: { width: 375, height: 720 } }); // mobile-first
      await page.goto(`file://${file}`);

      // Question 1 renders instantly (no network dependency).
      await page.waitForSelector('.cfq-q');
      expect(await page.textContent('.cfq-q')).toContain('What sound does your door make?');
      const bar = await page.getAttribute('#cfq-bar', 'style');
      expect(bar).toContain('width');

      // One question per screen: answering advances.
      await page.click('.cfq-opt >> nth=0');
      expect(await page.textContent('.cfq-q')).toContain('How old is the spring?');

      // After the last question: the lead-capture step (before results).
      await page.click('.cfq-opt >> nth=1');
      expect(await page.textContent('.cfq-q')).toContain('Where should we send your diagnosis?');
      expect(await page.isVisible('#cfq-f-email')).toBe(true);
      expect(await page.textContent('#cfq-submit')).toBe('Send it');
    } finally {
      await browser.close();
    }
  }, 60_000);
});
