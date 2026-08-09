import { h } from 'preact';
import htm from 'htm';
import { ResultQrPanel } from './ResultQr.js';

const html = htm.bind(h);

// 자동 리셋 아님 — 관리자가 다음 세션을 수동으로 시작할 때까지 QR과 함께 화면 유지. docs/초안.md 7-⑤ 참고.
export function ThanksScreen({ resultId }) {
  return html`
    <div class="card thanks-card">
      <p class="eyebrow">36조 · 수학 도형 무기 배틀</p>
      <h2 class="title">체험해주셔서<br />감사합니다!</h2>
      <p class="subtitle">아직 QR을 못 찍었다면 지금 찍어주세요</p>
      <${ResultQrPanel} resultId=${resultId} />
    </div>
  `;
}
