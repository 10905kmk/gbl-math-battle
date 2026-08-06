import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// TODO: Supabase 프로젝트를 만든 뒤(backend/lib/supabase/schema.sql 실행 포함) Project
// Settings > API에서 이 두 값을 채울 것. anon key는 읽기 전용이라(schema.sql의
// "public read" RLS 정책 — select만 허용, insert/update/delete는 서버의 service key로만
// 가능) 브라우저에 그대로 노출해도 안전하게 설계되어 있다. service key와 절대 혼동하지
// 말 것 — 그건 여기(정적 파일, 누구나 볼 수 있음)에 넣으면 안 된다.
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

// Supabase에서 URL의 id로 결과를 조회하는 상시 페이지.
// 현장 result.js와 동일한 수준의 요약을 영구 소장하는 용도. docs/초안.md 7-④ 참고.
function ResultPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const id = new URLSearchParams(location.search).get('id');

  useEffect(() => {
    if (!id) {
      setError('결과 id가 없습니다 — QR코드를 다시 스캔해주세요.');
      return;
    }
    let cancelled = false;
    // PostgREST(Supabase가 테이블마다 자동으로 만들어주는 REST API) 규칙: ?id=eq.<value>가
    // "id 컬럼이 이 값과 같은 행"을 뜻한다. 응답은 항상 배열(행이 0개면 빈 배열)이라, 단일
    // 객체를 기대하는 Accept 헤더 대신 배열을 그대로 받아 첫 번째 원소를 쓰는 쪽이 더
    // 안전하다(행이 없는 경우를 "네트워크 에러"가 아니라 정상적인 빈 배열로 구분 가능).
    const url = `${SUPABASE_URL}/rest/v1/results?id=eq.${encodeURIComponent(id)}&select=*`;
    fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
        return res.json();
      })
      .then((rows) => {
        if (cancelled) return;
        if (!Array.isArray(rows) || rows.length === 0) {
          setError('결과를 찾을 수 없습니다.');
          return;
        }
        setResult(rows[0]);
      })
      .catch(() => {
        if (!cancelled) setError('결과를 불러오는 중 문제가 발생했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return html`<p class="result-error">${error}</p>`;
  if (!result) return html`<p>결과를 불러오는 중...</p>`;

  // 탈락이 없는 점수제라 승/패 대신 등수를 보여준다 — 현장 화면(frontend/src/screens/result.js)과
  // 같은 원칙(2026-08-06 게임 제한시간/결과 화면 개선 작업 참고).
  const rankLabel = result.rank ? `${result.rank}위` : '순위 미집계';

  return html`
    <div class="result-card">
      <h2>${result.weapon_name ?? '무기'}</h2>
      ${result.weapon_image && html`<img src=${result.weapon_image} alt=${result.weapon_name} />`}
      <p>전투력 ${result.weapon_damage ?? '-'}</p>
      <p class="result-rank">${rankLabel}</p>
      ${result.score != null && html`<p class="result-score">획득 점수 ${result.score}</p>`}
    </div>
  `;
}

render(html`<${ResultPage} />`, document.getElementById('result-app'));
