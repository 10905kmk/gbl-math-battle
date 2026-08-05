import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { CanvasEditor } from './create/CanvasEditor.js';
import { ChatPanel } from './create/ChatPanel.js';

const html = htm.bind(h);

// 캔버스(좌) + AI 채팅(우) 병렬 구조. docs/초안.md 7-②, 2026-08-05 설계 문서 참고.
export function CreateScreen({ socket, state }) {
  const [weaponState, setWeaponState] = useState({ parts: [] });
  const [phase, setPhase] = useState('editing'); // editing | evaluating | waiting
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stageRef = useRef(null);

  useEffect(() => {
    socket.on('create:progress', setProgress);
    return () => socket.off('create:progress', setProgress);
  }, [socket]);

  async function evaluate() {
    setPhase('evaluating');
    setError(null);
    let damage;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState }),
      });
      if (!res.ok) throw new Error(`evaluate request failed with ${res.status}`);
      const data = await res.json();
      damage = data.damage;
    } catch (err) {
      // 예전엔 여기서 damage=1로 조용히 대체하고 그대로 waiting 화면으로 넘어갔다 — 네트워크
      // 문제 한 번으로 참가자가 최저 점수에 영구히 고정되고 재시도도 못 했다(Opus 리뷰
      // Important #12). 이제는 편집 화면에 그대로 남겨서 다시 시도할 수 있게 한다.
      setPhase('editing');
      setError('평가에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
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
      <div class="evaluate-panel">
        ${error ? html`<p class="evaluate-error">${error}</p>` : null}
        <button
          class="evaluate-btn"
          onClick=${evaluate}
          disabled=${phase !== 'editing' || weaponState.parts.length === 0}
        >
          ${phase === 'evaluating' ? '평가 중...' : 'AI 평가받기'}
        </button>
      </div>
    </div>
  `;
}
