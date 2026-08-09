// 매 판 시작 전, 카지노 룰렛처럼 3칸이 각각 돌다가 멈추고 그중 하나를 고른다.
//
// 서버가 이미 참가자별로 3개 후보(skillChoices)를 정해서 내려준다 — 클라이언트는 "돌아가는
// 것처럼 보이게" 하는 연출만 담당한다. 뽑기 결과를 클라이언트가 정하면 참가자마다 다른 값을
// 갖게 되거나 조작될 수 있으므로, 여기서는 절대 뽑지 않는다.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { SKILLS, getSkill } from '../../../../shapes/skills.js';

const html = htm.bind(h);

// 칸마다 멈추는 시각을 다르게 해서(0.9초 / 1.5초 / 2.1초) 순서대로 착착 멈추는 느낌을 준다.
const STOP_DELAYS = [900, 1500, 2100];
const SPIN_INTERVAL_MS = 70;

function SkillCard({ skill, state, selected, onPick, disabled }) {
  // state: 'spinning' | 'ready'
  const spinning = state === 'spinning';
  return html`
    <button
      class="skill-card ${spinning ? 'is-spinning' : ''} ${selected ? 'is-selected' : ''}"
      disabled=${spinning || disabled}
      onClick=${() => onPick(skill.id)}
      style=${{ '--skill-color': skill.color }}
    >
      <span class="skill-icon">${skill.icon}</span>
      <span class="skill-name">${skill.name}</span>
      ${spinning
        ? null
        : html`
            <span class="skill-desc">${skill.desc}</span>
            <span class="skill-cool">
              ${skill.cooldownMs > 0 ? `쿨타임 ${Math.round(skill.cooldownMs / 1000)}초` : '패시브 · 자동 발동'}
            </span>
          `}
    </button>
  `;
}

export function SkillRoulette({ choices, picked, onPick }) {
  // 각 칸이 아직 돌고 있는지. 실제 결과(choices)는 처음부터 알고 있지만 연출을 위해 감춰둔다.
  const [stopped, setStopped] = useState([false, false, false]);
  // 돌아가는 동안 스쳐 지나가는 스킬들(연출용 더미).
  const [spinFrame, setSpinFrame] = useState(0);

  useEffect(() => {
    const spin = setInterval(() => setSpinFrame((f) => f + 1), SPIN_INTERVAL_MS);
    const timers = STOP_DELAYS.map((delay, i) =>
      setTimeout(() => setStopped((prev) => prev.map((v, j) => (j === i ? true : v))), delay),
    );
    return () => {
      clearInterval(spin);
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    // 세 칸이 다 멈추면 더 이상 프레임을 돌릴 이유가 없다.
    if (stopped.every(Boolean)) setSpinFrame((f) => f);
  }, [stopped]);

  const allStopped = stopped.every(Boolean);

  return html`
    <div class="card roulette-card">
      <p class="eyebrow">특수 스킬 뽑기</p>
      <h2 class="title">3개 중 하나를 고르세요</h2>
      <p class="subtitle">
        ${picked
          ? '선택 완료! 다른 참가자와 진행자의 시작을 기다리는 중입니다'
          : allStopped
            ? '카드를 눌러 선택하세요'
            : '룰렛이 돌아가는 중...'}
      </p>

      <div class="skill-grid">
        ${[0, 1, 2].map((i) => {
          const realId = choices[i];
          // 돌아가는 동안에는 전체 스킬 목록을 빠르게 순환시켜 보여준다.
          const shown = stopped[i] ? getSkill(realId) : SKILLS[(spinFrame + i * 3) % SKILLS.length];
          if (!shown) return null;
          return html`
            <${SkillCard}
              key=${i}
              skill=${shown}
              state=${stopped[i] ? 'ready' : 'spinning'}
              selected=${picked === realId}
              disabled=${Boolean(picked)}
              onPick=${onPick}
            />
          `;
        })}
      </div>

      <p class="roulette-hint">
        전원이 고른 뒤 진행자가 게임을 시작해요 · 게임 중 <kbd>Z</kbd> 또는 화면 버튼으로 사용
      </p>
    </div>
  `;
}
