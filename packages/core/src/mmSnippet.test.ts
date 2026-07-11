import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMessageMatchSnippet } from './mmSnippet.js';

const ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('message-match snippet validation', () => {
  it('rejects bad inputs', () => {
    expect(() => renderMessageMatchSnippet({ assetId: ASSET_ID, apiBase: 'nope' })).toThrow(/absolute origin/);
    expect(() => renderMessageMatchSnippet({ assetId: 'short', apiBase: 'https://x.test' })).toThrow(/26-char/);
  });
});

describe('message-match runtime in a real browser (WO-041 acceptance)', () => {
  let server: Server;
  let origin = '';
  const impressions: Array<{ utm_content: string; matched: boolean }> = [];
  let apiHits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      if (url.pathname === '/page') {
        const snippet = renderMessageMatchSnippet({ assetId: ASSET_ID, apiBase: origin });
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><html><head><meta charset="utf-8">${snippet}</head>
<body>
<h1 data-mm="headline">Control Headline</h1>
<p data-mm="lead">Control lead paragraph.</p>
<p id="static">Untouched copy.</p>
</body></html>`);
        return;
      }
      if (url.pathname === `/api/mm/${ASSET_ID}` && req.method === 'GET') {
        apiHits++;
        const utm = url.searchParams.get('utm_content');
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(
          utm === 'meta_ad:headline-1'
            ? JSON.stringify({ headline: 'The Six A.M. Snap', lead: 'Variant lead for the fear angle.' })
            : JSON.stringify({}),
        );
        return;
      }
      if (url.pathname === `/api/mm/${ASSET_ID}/impression` && req.method === 'POST') {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          impressions.push(JSON.parse(body) as { utm_content: string; matched: boolean });
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end('{"ok":true}');
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('swaps headline+lead under 50ms after first paint and logs the impression', async () => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}/page?utm_content=${encodeURIComponent('meta_ad:headline-1')}`);
      await page.waitForFunction('window.__mmSwapAt !== undefined');

      expect(await page.textContent('h1')).toBe('The Six A.M. Snap'); // swapped
      expect(await page.textContent('p[data-mm="lead"]')).toBe('Variant lead for the fear angle.');
      expect(await page.textContent('#static')).toBe('Untouched copy.');
      // Hold style removed → visible again.
      expect(await page.evaluate('document.getElementById("__mm_hold")')).toBeNull();

      // Acceptance: swap lands within 50ms of first paint.
      const timing = await page.evaluate(`(() => {
        const paints = performance.getEntriesByType('paint');
        const fp = paints.length ? Math.min(...paints.map((p) => p.startTime)) : 0;
        return { swapAt: window.__mmSwapAt, firstPaint: fp };
      })()`) as { swapAt: number; firstPaint: number };
      expect(timing.swapAt - timing.firstPaint).toBeLessThan(50);

      // Impression logged to the middleware.
      await page.waitForTimeout(150);
      expect(impressions.some((i) => i.utm_content === 'meta_ad:headline-1' && i.matched)).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('unmapped utm_content falls back to control cleanly; no utm makes zero API calls', async () => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}/page?utm_content=unknown-campaign`);
      await page.waitForFunction('window.__mmSwapAt !== undefined');
      expect(await page.textContent('h1')).toBe('Control Headline'); // control retained
      expect(await page.evaluate('document.getElementById("__mm_hold")')).toBeNull(); // revealed
      expect(await page.evaluate('getComputedStyle(document.querySelector("h1")).visibility')).toBe('visible');

      const before = apiHits;
      const page2 = await browser.newPage();
      await page2.goto(`${origin}/page`); // control traffic: no utm_content
      await page2.waitForTimeout(200);
      expect(await page2.textContent('h1')).toBe('Control Headline');
      expect(apiHits).toBe(before); // zero middleware calls
    } finally {
      await browser.close();
    }
  }, 60_000);
});
