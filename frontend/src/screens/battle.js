import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

// 대전 형식 미정 (페어링 방식, 게임 유형 등) — docs/초안.md 7-③, 8번 참고.
// 팀 내부 논의 후 재설계 필요.
export function BattleScreen() {
  return html`<p>대전 화면 (설계 예정)</p>`;
}
