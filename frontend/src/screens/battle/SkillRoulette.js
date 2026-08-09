import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { SKILLS, getSkill, formatSkillTiming } from '../../../../shapes/skills.js';

const html = htm.bind(h);
const STOP_DELAYS = [600, 750, 900, 1050, 1200, 1350, 1500, 1650, 1800];
const SPIN_INTERVAL_MS = 70;

function SkillCard({ skill, spinning, selected, onPick, disabled }) {
  return html`
    <button
      type="button"
      class="skill-card ${spinning ? 'is-spinning' : ''} ${selected ? 'is-selected' : ''}"
      disabled=${spinning || disabled}
      onClick=${() => onPick(skill.id)}
      style=${{ '--skill-color': skill.color }}
    >
      <span class="skill-icon">${skill.icon}</span>
      <span class="skill-name">${skill.name}</span>
      ${spinning ? null : html`
        <span class="skill-desc">${skill.desc}</span>
        <span class="skill-cool">${formatSkillTiming(skill)}</span>
      `}
    </button>
  `;
}

export function SkillRoulette({ choices, picked = [], confirmed = false, onPick, onConfirm }) {
  const [stopped, setStopped] = useState(() => choices.map(() => false));
  const [spinFrame, setSpinFrame] = useState(0);

  useEffect(() => {
    setStopped(choices.map(() => false));
    const spin = setInterval(() => setSpinFrame((frame) => frame + 1), SPIN_INTERVAL_MS);
    const timers = STOP_DELAYS.slice(0, choices.length).map((delay, index) =>
      setTimeout(() => setStopped((previous) => previous.map((value, i) => (i === index ? true : value))), delay));
    return () => {
      clearInterval(spin);
      timers.forEach(clearTimeout);
    };
  }, [choices.join('|')]);

  const allStopped = stopped.length === choices.length && stopped.every(Boolean);
  const subtitle = confirmed
    ? '선택이 확정되었습니다. 관리자의 게임 시작을 기다려 주세요.'
    : picked.length === 4
      ? '4개를 골랐습니다. 아래 선택 확정 버튼을 눌러 주세요.'
      : allStopped
        ? `카드를 눌러 선택하세요 (${picked.length}/4)`
        : '룰렛이 돌아가는 중...';

  return html`
    <div class="card roulette-card">
      <p class="eyebrow">특수 스킬 뽑기</p>
      <h2 class="title">9개 중 4개를 고르세요</h2>
      <p class="subtitle">${subtitle}</p>

      <div class="skill-grid">
        ${choices.map((realId, index) => {
          const spinning = !stopped[index];
          const shown = spinning ? SKILLS[(spinFrame + index * 3) % SKILLS.length] : getSkill(realId);
          if (!shown) return null;
          return html`
            <${SkillCard}
              key=${realId}
              skill=${shown}
              spinning=${spinning}
              selected=${picked.includes(realId)}
              disabled=${confirmed || (picked.length >= 4 && !picked.includes(realId))}
              onPick=${onPick}
            />
          `;
        })}
      </div>

      <button
        type="button"
        class="roulette-confirm ${confirmed ? 'is-confirmed' : ''}"
        disabled=${confirmed || !allStopped || picked.length !== 4}
        onClick=${onConfirm}
      >
        ${confirmed ? '선택 확정 완료' : `선택 확정 (${picked.length}/4)`}
      </button>

      <p class="roulette-hint">
        전원이 선택을 확정한 뒤 관리자가 게임을 시작합니다. 게임 중 <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd>로 사용
      </p>
    </div>
  `;
}
