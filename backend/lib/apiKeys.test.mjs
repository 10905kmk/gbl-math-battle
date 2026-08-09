import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  addApiKeyToFile,
  detectApiKeyProvider,
  loadApiKeysFromFile,
  filterValidKeys,
  maskApiKey,
} from './apiKeys.js';

// 실제 backend/config/apiKeys.json(사용자의 진짜 키가 들어갈 수 있는 gitignore 대상 파일)은
// 절대 건드리지 않는다 — 테스트 전용 임시 파일만 사용한다.
const SCRATCH_DIR = path.join(process.cwd(), '.test-scratch');
mkdirSync(SCRATCH_DIR, { recursive: true });

// 정상 파일
{
  const p = path.join(SCRATCH_DIR, 'apiKeys.valid.json');
  writeFileSync(p, JSON.stringify({ gemini: ['a', 'b'] }));
  assert.deepStrictEqual(loadApiKeysFromFile(p), { gemini: ['a', 'b'] });
}
console.log('loadApiKeysFromFile reads a valid JSON file: OK');

// 없는 파일 -> 빈 객체(크래시 없음) — 사용자가 아직 apiKeys.json을 안 만들었을 때의 정상 상태
{
  const result = loadApiKeysFromFile(path.join(SCRATCH_DIR, 'does-not-exist.json'));
  assert.deepStrictEqual(result, {});
}
console.log('loadApiKeysFromFile tolerates a missing file: OK');

// 깨진 JSON -> 빈 객체(크래시 없음)
{
  const p = path.join(SCRATCH_DIR, 'apiKeys.broken.json');
  writeFileSync(p, '{ not valid json');
  const result = loadApiKeysFromFile(p);
  assert.deepStrictEqual(result, {});
}
console.log('loadApiKeysFromFile tolerates malformed JSON: OK');

// filterValidKeys — 빈 문자열/공백/문자열이 아닌 값은 걸러진다
{
  assert.deepStrictEqual(filterValidKeys(['a', '', '  ', 'b', 123, null]), ['a', 'b']);
  assert.deepStrictEqual(filterValidKeys(undefined), []);
  assert.deepStrictEqual(filterValidKeys('not-an-array'), []);
}
console.log('filterValidKeys drops empty/non-string entries: OK');

assert.deepStrictEqual(filterValidKeys([' key-a ', 'key-a', 'key-b']), ['key-a', 'key-b']);
console.log('filterValidKeys trims and removes duplicate keys: OK');

assert.strictEqual(detectApiKeyProvider('ghp_123456789012345678901234567890123456'), 'github');
assert.strictEqual(detectApiKeyProvider('sk-or-v1-123456789012345678901234567890'), 'openrouter');
assert.strictEqual(detectApiKeyProvider('AIza123456789012345678901234567890'), 'gemini');
assert.strictEqual(detectApiKeyProvider('unknown-key'), null);
console.log('detectApiKeyProvider identifies supported provider key formats: OK');

// 관리자 긴급 키 추가 — 기존 provider를 보존하고 중복은 추가하지 않으며 원문을 상태에 노출하지 않는다.
{
  const p = path.join(SCRATCH_DIR, 'apiKeys.add.json');
  writeFileSync(p, JSON.stringify({ gemini: ['existing-key-1234567890'], openai: ['keep-me'] }));
  const added = addApiKeyToFile(p, 'gemini', 'new-gemini-key-1234567890');
  assert.strictEqual(added.added, true);
  assert.deepStrictEqual(loadApiKeysFromFile(p), {
    gemini: ['existing-key-1234567890', 'new-gemini-key-1234567890'],
    openai: ['keep-me'],
  });
  const duplicate = addApiKeyToFile(p, 'gemini', 'new-gemini-key-1234567890');
  assert.strictEqual(duplicate.added, false);
  assert.strictEqual(maskApiKey('new-gemini-key-1234567890'), '****7890');
}
console.log('admin API key addition preserves config, rejects duplicates, and masks secrets: OK');

rmSync(SCRATCH_DIR, { recursive: true, force: true });
console.log('apiKeys.test.mjs: OK');
