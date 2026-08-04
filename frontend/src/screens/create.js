import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { CanvasEditor } from './create/CanvasEditor.js';
import { ChatPanel } from './create/ChatPanel.js';

const html = htm.bind(h);

// 캔버스(좌) + AI 채팅(우) 병렬 구조. docs/초안.md 7-②, 2026-08-05 설계 문서 참고.
export function CreateScreen({ socket, state }) {
  const [weaponState, setWeaponState] = useState({ parts: [] });
  const [phase, setPhase] = useState('editing'); // editing | evaluating | waiting
  const [progress] = useState({ done: 0, total: 5 });
  const stageRef = useRef(null);

  async function evaluate() {
    setPhase('evaluating');
    let damage = 1;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState }),
      });
      const data = await res.json();
      damage = data.damage;
    } catch (err) {
      damage = 1;
    }
    const previewImage = stageRef.current ? stageRef.current.toDataURL() : null;
    const weapon = {
      name: '내가 만든 무기',
      image: previewImage,
      stats: { attack: damage, defense: damage },
      damage,
      parts: weaponState.parts,
    };
    state.weapon = weapon;
    setPhase('waiting');
    socket.emit('create:done', weapon);
  }

  if (phase === 'waiting') {
    return html`
      <div class="weapon-card">
        <h3>${state.weapon?.name}</h3>
        <p>다른 도전자를 기다리는 중... (${progress.done}/${progress.total})</p>
      </div>
    `;
  }

  return html`
    <div class="create-shell">
      <${CanvasEditor}
        parts=${weaponState.parts}
        onChange=${(parts) => setWeaponState({ parts })}
        onStageReady=${(stage) => {
          stageRef.current = stage;
        }}
        disabled=${phase !== 'editing'}
      />
      <${ChatPanel}
        weaponState=${weaponState}
        onWeaponChange=${setWeaponState}
        disabled=${phase !== 'editing'}
      />
      <button
        class="evaluate-btn"
        onClick=${evaluate}
        disabled=${phase !== 'editing' || weaponState.parts.length === 0}
      >
        ${phase === 'evaluating' ? '평가 중...' : 'AI 평가받기'}
      </button>
    </div>
  `;
}
