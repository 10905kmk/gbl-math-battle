import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveResult } from './supabaseClient.js';

// 회귀 테스트: SUPABASE_URL만 설정되고 SUPABASE_SERVICE_KEY는 비어있는 "반쪽 설정" 상태에서
// 모듈을 로드해도 서버 전체가 죽지 않아야 한다(Opus 리뷰 Critical #1 — createClient()가
// 키 없이 호출되면 "supabaseKey is required"로 모듈 로드 시점에 즉시 throw했었음).
{
  const thisFile = fileURLToPath(import.meta.url);
  const moduleFile = thisFile.replace('supabaseClient.test.mjs', 'supabaseClient.js');
  execFileSync(
    process.execPath,
    ['-e', `import(${JSON.stringify('file://' + moduleFile)}).then(() => console.log('loaded ok'))`],
    { env: { ...process.env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: '' }, stdio: 'pipe' },
  );
  console.log('supabaseClient survives half-configured env (URL only, no key): OK');
}

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
