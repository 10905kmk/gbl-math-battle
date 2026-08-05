import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadApiKeysFromFile, filterValidKeys } from './apiKeys.js';

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

rmSync(SCRATCH_DIR, { recursive: true, force: true });
console.log('apiKeys.test.mjs: OK');
