import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDuckDuckGoHtml,
  parseYahooSearchBody,
  parseWikipediaOpensearch,
  decodeDuckDuckGoHref,
  webSearch,
  WEB_SEARCH_NOTE
} from './web-search.js';

const root = dirname(fileURLToPath(import.meta.url));
const RECORDED_DDG = readFileSync(
  join(root, '../fixtures/ddg-cdns-search.recorded.html'),
  'utf8'
);

test('DuckDuckGo recorded HTML parses titles and decoded URLs', () => {
  assert.match(RECORDED_DDG, /RECORDED_FIXTURE/);
  const results = parseDuckDuckGoHtml(RECORDED_DDG);
  assert.ok(results.length >= 2);
  assert.strictEqual(results[0].url, 'https://finance.yahoo.com/quote/CDNS/');
  assert.match(results[0].title, /Cadence/);
  assert.match(results[1].snippet, /CDNS news/i);
});

test('decodeDuckDuckGoHref unwraps uddg', () => {
  assert.strictEqual(
    decodeDuckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa'),
    'https://example.com/a'
  );
});

test('Yahoo search body maps quotes and news without inventing prices', () => {
  const results = parseYahooSearchBody({
    quotes: [{ symbol: 'CDNS', shortname: 'Cadence Design Systems, Inc.', quoteType: 'EQUITY', exchDisp: 'NASDAQ' }],
    news: [{ title: 'Why CDNS moved', publisher: 'Zacks', link: 'https://example.test/n', providerPublishTime: 1789156801 }]
  });
  assert.strictEqual(results[0].symbol, 'CDNS');
  assert.ok(!Object.prototype.hasOwnProperty.call(results[0], 'close'));
  assert.strictEqual(results[1].source, 'yahoo-news');
  assert.match(results[1].title, /CDNS/);
});

test('Wikipedia opensearch parser keeps title + url', () => {
  const results = parseWikipediaOpensearch([
    'Cadence',
    ['Cadence Design Systems'],
    ['American software company'],
    ['https://en.wikipedia.org/wiki/Cadence_Design_Systems']
  ]);
  assert.strictEqual(results[0].source, 'wikipedia');
  assert.match(results[0].url, /Cadence_Design_Systems/);
});

test('webSearch returns honest empty when sources fail', async () => {
  const result = await webSearch('CDNS', {
    httpGet: async () => {
      throw new Error('network down');
    }
  });
  assert.deepStrictEqual(result.results, []);
  assert.match(result.note, /no snippets|failed/i);
  assert.match(WEB_SEARCH_NOTE, /not invented/i);
});
