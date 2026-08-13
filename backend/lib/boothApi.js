// GBL2026 허브(이 저장소 밖의 외부 시스템)와 통신하는 클라이언트. 부스 비밀번호는
// 여기서만 다루고 브라우저로는 절대 내보내지 않는다(HAR 분석 보고서가 지적한 평문
// 비밀번호 노출 위험을 이 프록시 계층으로 막는다).
let cachedBid = null;

function baseUrl() {
  return process.env.BOOTH_API_URL || 'https://34-227-8-239.sslip.io';
}

function password() {
  return process.env.BOOTH_PASSWORD || '';
}

// 로그인 실패는 캐싱하지 않는다 — 허브가 일시적으로 다운됐을 수 있으므로 다음 호출에서
// 다시 시도할 수 있어야 한다.
export async function login() {
  const res = await fetch(`${baseUrl()}/api/auth/boothadmin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password() }),
  });
  if (!res.ok) {
    throw new Error(`boothadmin login failed: ${res.status}`);
  }
  const data = await res.json();
  cachedBid = data.bid;
  return cachedBid;
}

export async function fetchUser(uid) {
  try {
    const res = await fetch(`${baseUrl()}/api/user/${encodeURIComponent(uid)}`);
    if (!res.ok) {
      return { ok: false, status: res.status, message: `조회 실패 (${res.status})` };
    }
    const data = await res.json();
    return { ok: true, name: data.name, profile_image: data.profile_image };
  } catch (err) {
    return { ok: false, status: 502, message: err.message };
  }
}

export async function addUser(uid) {
  try {
    if (!cachedBid) await login();
    const res = await fetch(`${baseUrl()}/api/booth/adduser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, bid: cachedBid, password: password() }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `등록 실패 (${res.status})` };
    }
    const data = await res.json();
    return { ok: true, status: data.status };
  } catch (err) {
    return { ok: false, status: 502, message: err.message };
  }
}

// 테스트 전용 — 모듈 싱글턴 bid 캐시를 초기화한다.
export function _resetCacheForTest() {
  cachedBid = null;
}
