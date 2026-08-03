import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// TODO: 학습한 도형/프랙탈 목록으로 채우기 (shapes/shapes.js, shapes/fractals.js 참고)
const SHAPES = [];

// 2단계 구성(도형 선택 -> 자연어 설명) + 생성 후 대기 화면. docs/초안.md 7-② 참고.
// AI 실패 시 기본 무기 대체, 자동 확정(재생성 없음)은 잠정 결정 — 초안 8번 참고.
export function CreateScreen({ socket, state }) {
  const [step, setStep] = useState('select-shape');
  const [shape, setShape] = useState(null);
  const [description, setDescription] = useState('');
  const [weapon, setWeapon] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 5 });

  async function generate() {
    setStep('loading');
    let result;
    try {
      const res = await fetch('/api/weapon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shape, description }),
      });
      if (!res.ok) throw new Error('weapon generation failed');
      result = await res.json();
    } catch (err) {
      result = { name: `${shape?.name ?? '도형'}의 기본형`, stats: shape?.baseStats ?? {} };
    }
    setWeapon(result);
    state.weapon = result;
    setStep('waiting');
    socket.emit('create:done', result);
  }

  if (step === 'select-shape') {
    return html`
      <div class="shape-grid">
        ${SHAPES.map((s) => html`
          <button onClick=${() => { setShape(s); setStep('describe'); }}>${s.name}</button>
        `)}
      </div>
    `;
  }

  if (step === 'describe') {
    return html`
      <div class="describe-form">
        <p>선택: ${shape?.name}</p>
        <textarea
          value=${description}
          onInput=${(e) => setDescription(e.target.value)}
          placeholder="이 도형으로 어떤 무기를 만들까요?"
        />
        <button onClick=${generate}>생성하기</button>
      </div>
    `;
  }

  if (step === 'loading') {
    return html`<p>무기를 단조 중입니다...</p>`;
  }

  return html`
    <div class="weapon-card">
      <h3>${weapon?.name}</h3>
      <p>다른 도전자를 기다리는 중... (${progress.done}/${progress.total})</p>
    </div>
  `;
}
