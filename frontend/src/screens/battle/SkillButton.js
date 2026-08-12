// 특수 스킬 발동 버튼(모바일) + 쿨타임 표시. PC는 Z키가 같은 동작을 한다(battle.js).
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { getSkill } from '../../../../shapes/skills.js';

const html = htm.bind(h);

export function SkillButton({ skillId, readyAt, onUse, keyLabel }) {
  const skill = getSkill(skillId);
  // 쿨타임은 "언제 준비되는지(readyAt)"만 서버가 주므로, 남은 시간은 클라이언트가 매
  // 프레임 계산한다 — 서버 틱(50ms)에만 의존하면 숫자가 뚝뚝 끊겨 보인다.
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  if (!skill) return null;

  // 패시브는 누를 게 없다 — 무엇을 가졌는지만 알려준다.
  if (skill.kind === 'passive') {
    return html`
      <div class="skill-btn is-passive" style=${{ '--skill-color': skill.color }} title=${skill.desc}>
        <span class="skill-btn-icon">${skill.icon}</span>
        <span class="skill-btn-label">${keyLabel} · 자동</span>
      </div>
    `;
  }

  const remainMs = Math.max(0, (readyAt ?? 0) - now);
  const ready = remainMs <= 0;
  const total = skill.cooldownMs || 1;
  // 남은 비율만큼 아래에서 차오르는 그림자로 쿨타임을 표현한다(원형 게이지보다 단순하고
  // 작은 화면에서도 한눈에 읽힌다).
  const fillPercent = ready ? 0 : Math.round((remainMs / total) * 100);

  function activateFromPointer(event) {
    // 모바일은 touch -> click 변환이 스크롤/미세한 손가락 이동 때문에 취소될 수 있으므로
    // pointerdown에서 즉시 한 번 발동한다. 뒤이어 생성되는 click은 아래에서 무시한다.
    event.preventDefault();
    onUse();
  }

  function activateFromKeyboard(event) {
    // 키보드로 버튼에 초점을 둔 뒤 Enter/Space를 누르면 detail=0인 click이 발생한다.
    // 실제 포인터 click(detail>0)은 pointerdown에서 이미 처리했으므로 중복 발동하지 않는다.
    if (event.detail === 0) onUse();
  }

  return html`
    <button
      type="button"
      class="skill-btn ${ready ? 'is-ready' : 'is-cooling'}"
      style=${{ '--skill-color': skill.color, '--cool-fill': `${fillPercent}%` }}
      onPointerDown=${activateFromPointer}
      onClick=${activateFromKeyboard}
      disabled=${!ready}
      title=${skill.desc}
      aria-label=${`${keyLabel} ${skill.name} 발동`}
    >
      <span class="skill-btn-icon">${skill.icon}</span>
      <span class="skill-btn-label">${keyLabel} · ${ready ? skill.name : `${Math.ceil(remainMs / 1000)}`}</span>
    </button>
  `;
}
