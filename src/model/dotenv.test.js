import { test } from 'node:test';
import assert from 'node:assert';
import { parseDotenv, loadDotenv } from './dotenv.js';

test('parseDotenv ignores comments and supports quotes', () => {
  const parsed = parseDotenv([
    '# comment',
    'SCOREBOARD_CHAT_PROVIDER=xai',
    'SCOREBOARD_CHAT_MODEL="grok-4.6"',
    "SCOREBOARD_XAI_BASE_URL='https://api.x.ai/v1'",
    'export SCOREBOARD_OPENAI_API_KEY=test-openai',
    'BROKEN',
    '9BAD=no',
    'PLAIN=value # trailing comment'
  ].join('\n'));
  assert.strictEqual(parsed.SCOREBOARD_CHAT_PROVIDER, 'xai');
  assert.strictEqual(parsed.SCOREBOARD_CHAT_MODEL, 'grok-4.6');
  assert.strictEqual(parsed.SCOREBOARD_XAI_BASE_URL, 'https://api.x.ai/v1');
  assert.strictEqual(parsed.SCOREBOARD_OPENAI_API_KEY, 'test-openai');
  assert.strictEqual(parsed.PLAIN, 'value');
  assert.ok(!parsed.BROKEN);
  assert.ok(!parsed['9BAD']);
});

test('loadDotenv does not overwrite existing env and never returns values', () => {
  const env = { SCOREBOARD_CHAT_PROVIDER: 'openai', KEEP: 'yes' };
  const result = loadDotenv({
    env,
    cwd: '/tmp',
    filename: 'scoreboard-dotenv-test.env',
    exists: () => true,
    readFile: () => [
      'SCOREBOARD_CHAT_PROVIDER=xai',
      'SCOREBOARD_CHAT_MODEL=grok-4.6',
      'SCOREBOARD_XAI_API_KEY=test-xai'
    ].join('\n')
  });
  assert.strictEqual(result.loaded, true);
  assert.deepStrictEqual(result.applied.sort(), ['SCOREBOARD_CHAT_MODEL', 'SCOREBOARD_XAI_API_KEY']);
  assert.strictEqual(env.SCOREBOARD_CHAT_PROVIDER, 'openai');
  assert.strictEqual(env.SCOREBOARD_CHAT_MODEL, 'grok-4.6');
  assert.ok(!JSON.stringify(result).includes('test-xai'));
});

test('loadDotenv is a no-op when the file is missing', () => {
  const env = {};
  const result = loadDotenv({
    env,
    exists: () => false,
    readFile: () => {
      throw new Error('should not read');
    }
  });
  assert.strictEqual(result.loaded, false);
  assert.deepStrictEqual(env, {});
});
