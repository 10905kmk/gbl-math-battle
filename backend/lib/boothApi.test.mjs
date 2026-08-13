import assert from 'node:assert';
import * as boothApi from './boothApi.js';

process.env.BOOTH_API_URL = 'https://fake-hub.test';
process.env.BOOTH_PASSWORD = 'test-pw';

function mockFetchSequence(responses) {
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    const step = responses[i++];
    if (!step) throw new Error('no more mock responses queued');
    step.assert?.(url, opts);
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.body,
    };
  };
}

// login: 성공 시 bid 반환
{
  boothApi._resetCacheForTest();
  mockFetchSequence([
    {
      status: 200,
      body: { bid: 'M8', is_created: true, role: 'booth_operator' },
      assert: (url, opts) => {
        assert.strictEqual(url, 'https://fake-hub.test/api/auth/boothadmin');
        assert.strictEqual(JSON.parse(opts.body).password, 'test-pw');
      },
    },
  ]);
  const bid = await boothApi.login();
  assert.strictEqual(bid, 'M8');
  console.log('login returns bid on success: OK');
}

// login: 실패 시 throw
{
  boothApi._resetCacheForTest();
  mockFetchSequence([{ status: 401, body: {} }]);
  await assert.rejects(() => boothApi.login());
  console.log('login throws on failure: OK');
}

// fetchUser: 성공
{
  mockFetchSequence([
    {
      status: 200,
      body: { name: '홍길동', profile_image: 'https://example.com/a.png', history: [] },
      assert: (url) => assert.strictEqual(url, 'https://fake-hub.test/api/user/abc123'),
    },
  ]);
  const result = await boothApi.fetchUser('abc123');
  assert.deepStrictEqual(result, { ok: true, name: '홍길동', profile_image: 'https://example.com/a.png' });
  console.log('fetchUser returns ok:true with name/profile_image: OK');
}

// fetchUser: 404
{
  mockFetchSequence([{ status: 404, body: {} }]);
  const result = await boothApi.fetchUser('없는uid');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 404);
  console.log('fetchUser returns ok:false on 404: OK');
}

// fetchUser: 네트워크 에러
{
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const result = await boothApi.fetchUser('abc123');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 502);
  console.log('fetchUser returns ok:false on network error: OK');
}

// addUser: bid 캐시 없으면 login을 먼저 호출한 뒤 등록
{
  boothApi._resetCacheForTest();
  mockFetchSequence([
    { status: 200, body: { bid: 'M8' } },
    {
      status: 200,
      body: { booth_code: 'M8', status: 'ok', user_name: '홍길동' },
      assert: (url, opts) => {
        assert.strictEqual(url, 'https://fake-hub.test/api/booth/adduser');
        const parsed = JSON.parse(opts.body);
        assert.strictEqual(parsed.uid, 'abc123');
        assert.strictEqual(parsed.bid, 'M8');
        assert.strictEqual(parsed.password, 'test-pw');
      },
    },
  ]);
  const result = await boothApi.addUser('abc123');
  assert.deepStrictEqual(result, { ok: true, status: 'ok' });
  console.log('addUser logs in first when bid not cached, then registers: OK');
}

// addUser: bid 캐시가 있으면 재로그인 없이 바로 등록
{
  mockFetchSequence([{ status: 200, body: { status: 'ok' } }]);
  const result = await boothApi.addUser('def456');
  assert.strictEqual(result.ok, true);
  console.log('addUser reuses cached bid without re-login: OK');
}

console.log('boothApi.test.mjs: all scenarios OK');
