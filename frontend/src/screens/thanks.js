import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

// 자동 리셋 아님 — 관리자가 다음 세션을 수동으로 시작할 때까지 QR과 함께 화면 유지. docs/초안.md 7-⑤ 참고.
export function ThanksScreen({ state }) {
  return html`
    <div class="thanks-card">
      <p>체험을 마쳐주셔서 감사합니다!</p>
      <div class="qr-slot"><!-- result 화면과 동일한 QR 유지 표시 --></div>
    </div>
  `;
}
