import { h } from 'preact';
import htm from 'htm';
import { ResultQrPanel } from './ResultQr.js';

const html = htm.bind(h);

// 현장 화면은 요약 + QR코드만 노출. 상세 내용은 result-page(Vercel)로 위임. docs/초안.md 7-④ 참고.
export function ResultScreen({ state, resultId }) {
  const { weapon, battleResult } = state;
  // 탈락이 없는 점수제라 승/패 대신 등수를 보여준다(공동 순위도 있을 수 있음) — battleResult는
  // battle.js의 battle:result 핸들러가 { win, score, rank, total }로 채워둔다.
  const rank = battleResult?.rank ?? null;

  return html`
    <div class="card result-card">
      <p class="eyebrow">대전 결과</p>

      ${rank
        ? html`
            <div class="rank-badge ${rank === 1 ? 'rank-badge--top' : ''}">
              <strong>${rank}</strong>
              <small>/ ${battleResult.total}명</small>
            </div>
          `
        : html`<p class="subtitle">결과 집계 중<span class="dots"><i></i><i></i><i></i></span></p>`}

      <div class="weapon-frame">
        ${weapon?.image
          ? html`<img src=${weapon.image} alt=${weapon?.name ?? '무기'} />`
          : html`<span class="weapon-frame--empty">이미지 없음</span>`}
      </div>
      <h2 class="weapon-name">${weapon?.name ?? '무기'}</h2>

      <dl class="stat-grid">
        <div class="stat stat--damage">
          <dt>전투력</dt>
          <dd>${weapon?.damage ?? '-'}</dd>
        </div>
        <div class="stat stat--score">
          <dt>획득 점수</dt>
          <dd>${battleResult?.score ?? '-'}</dd>
        </div>
      </dl>

      <${ResultQrPanel} resultId=${resultId} />
    </div>
  `;
}
