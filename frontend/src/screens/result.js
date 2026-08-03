import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

// 현장 화면은 요약 + QR코드만 노출. 상세 내용은 result-page(Vercel)로 위임. docs/초안.md 7-④ 참고.
export function ResultScreen({ state }) {
  const { weapon, battleResult } = state;

  return html`
    <div class="result-card">
      <h2>${weapon?.name ?? '무기'}</h2>
      <img src=${weapon?.image} alt=${weapon?.name} />
      <p>공격 ${weapon?.stats?.attack ?? '-'} / 방어 ${weapon?.stats?.defense ?? '-'}</p>
      <p>${battleResult === 'win' ? '승리' : battleResult === 'lose' ? '패배' : '결과 대기 중'}</p>
      <div class="qr-slot"><!-- QR코드는 qrcode.js 등으로 클라이언트에서 즉석 생성 --></div>
    </div>
  `;
}
