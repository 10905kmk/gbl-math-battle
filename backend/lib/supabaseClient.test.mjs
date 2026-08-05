import assert from 'node:assert';
import { saveResult } from './supabaseClient.js';

assert.strictEqual(
  process.env.SUPABASE_URL,
  undefined,
  '이 테스트는 SUPABASE_URL 미설정 상태를 전제로 함 — 셸 환경변수를 확인하세요',
);

const result = await saveResult({ weapon_name: '테스트 무기', win: true });
assert.ok(result.id, 'mock 저장도 id를 반환해야 함');
assert.strictEqual(result.weapon_name, '테스트 무기', '입력 필드가 그대로 보존되어야 함');
assert.strictEqual(result.win, true);
assert.ok(result.created_at, 'created_at이 채워져야 함');
console.log('saveResult mock fallback: OK');

const result2 = await saveResult({ weapon_name: '다른 무기', win: false });
assert.notStrictEqual(result.id, result2.id, '호출마다 다른 id를 반환해야 함');
console.log('saveResult mock fallback generates unique ids: OK');

console.log('supabaseClient.test.mjs: OK');
