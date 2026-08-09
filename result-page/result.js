import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { downloadCertificate } from './certificate.js';

const html = htm.bind(h);

const SUPABASE_URL = 'https://sfqhhclxzgvwvlpsmiou.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_N_wvfJULzEEi4Azpq-7YtA_adyPra5v';

// Supabase에서 URL의 id로 결과를 조회하는 상시 페이지.
// 현장 result.js와 동일한 수준의 요약을 영구 소장하는 용도 + PDF 증서 저장. docs/초안.md 7-④ 참고.
function ResultPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // idle | working | done-pdf | done-png | failed — PDF 생성은 캔버스를 그리고 jsPDF를
  // 내려받는 동안 1초 안팎 걸려서, 버튼이 아무 반응 없으면 참가자가 계속 다시 누른다.
  const [saveState, setSaveState] = useState('idle');
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

  async function save() {
    if (saveState === 'working') return;
    setSaveState('working');
    try {
      const kind = await downloadCertificate(result);
      setSaveState(kind === 'pdf' ? 'done-pdf' : 'done-png');
    } catch (err) {
      console.error('[result-page] 증서 저장 실패', err);
      setSaveState('failed');
    }
  }

  if (error) {
    return html`
      <div class="card state-card">
        <p class="state-emoji">🔍</p>
        <p class="result-error">${error}</p>
      </div>
    `;
  }
  if (!result) {
    return html`
      <div class="card state-card">
        <p class="subtitle">결과를 불러오는 중<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
    `;
  }

  // 탈락이 없는 점수제라 승/패 대신 등수를 보여준다 — 현장 화면(frontend/src/screens/result.js)과
  // 같은 원칙(2026-08-06 게임 제한시간/결과 화면 개선 작업 참고).
  const rank = Number.isFinite(result.rank) ? result.rank : null;

  const saveLabel = {
    idle: '📄 PDF로 저장하기',
    working: '만드는 중...',
    'done-pdf': '✓ 저장했어요 · 다시 받기',
    'done-png': '✓ 이미지로 저장했어요 · 다시 받기',
    failed: '다시 시도하기',
  }[saveState];

  return html`
    <div class="card result-card">
      <p class="eyebrow">수학 도형 무기 배틀</p>

      ${rank
        ? html`
            <div class="rank-badge ${rank === 1 ? 'rank-badge--top' : ''}">
              <strong>${rank}</strong>
              <small>위</small>
            </div>
          `
        : null}

      <div class="weapon-frame">
        ${result.weapon_image
          ? html`<img src=${result.weapon_image} alt=${result.weapon_name ?? '무기'} />`
          : html`<span class="weapon-frame--empty">이미지 없음</span>`}
      </div>
      <h1 class="weapon-name">${result.weapon_name ?? '무기'}</h1>

      <dl class="stat-grid">
        <div class="stat stat--damage">
          <dt>AI 전투력</dt>
          <dd>${result.weapon_damage ?? '-'}</dd>
        </div>
        <div class="stat stat--score">
          <dt>획득 점수</dt>
          <dd>${result.score ?? '-'}</dd>
        </div>
      </dl>

      <button
        class="btn btn--primary btn--block save-btn"
        onClick=${save}
        disabled=${saveState === 'working'}
      >
        ${saveLabel}
      </button>
      ${saveState === 'done-png'
        ? html`<p class="save-note">PDF를 만들지 못해 이미지로 저장했어요.</p>`
        : html`<p class="save-note">저장한 파일은 휴대폰 다운로드 폴더에 있어요</p>`}

      <p class="page-footer">대전대신고등학교 GBL · 36조</p>
    </div>
  `;
}

render(html`<${ResultPage} />`, document.getElementById('result-app'));
