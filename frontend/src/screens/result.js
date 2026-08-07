import { h } from 'preact';
import htm from 'htm';
import { ResultQr } from './ResultQr.js';

const html = htm.bind(h);

// 현장 화면은 요약 + QR코드만 노출. 상세 내용은 result-page(Vercel)로 위임. docs/초안.md 7-④ 참고.
export function ResultScreen({ state, resultId }) {
  const { weapon, battleResult } = state;
  // 탈락이 없는 점수제라 승/패 대신 등수를 보여준다(공동 순위도 있을 수 있음) — battleResult는
  // battle.js의 battle:result 핸들러가 { win, score, rank, total }로 채워둔다.
  const rankLabel = battleResult?.rank
    ? `${battleResult.rank}위 / 총 ${battleResult.total}명`
    : '결과 집계 중...';

  return html`
    <div class="result-card">
      <h2>${weapon?.name ?? '무기'}</h2>
      ${weapon?.image && html`<img src=${weapon.image} alt=${weapon?.name} />`}
      <p>전투력 ${weapon?.damage ?? '-'}</p>
      <p class="result-rank">${rankLabel}</p>
      ${battleResult?.score != null && html`<p class="result-score">획득 점수 ${battleResult.score}</p>`}
      <div class="qr-slot"><${ResultQr} resultId=${resultId} /></div>
    </div>
  `;
}
