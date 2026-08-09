import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { CanvasEditor, MAX_PARTS } from './create/CanvasEditor.js';
import { ChatPanel } from './create/ChatPanel.js';

const html = htm.bind(h);

// 참가자가 이름을 안 적고 평가받는 경우의 대체 이름. 결과 PDF/상시 페이지의 제목으로
// 그대로 쓰이므로 빈 문자열이 넘어가지 않게 여기서 한 번 막는다(서버도 다시 검증한다).
const FALLBACK_WEAPON_NAME = '이름 없는 무기';
export const WEAPON_NAME_MAX = 24;

// 캔버스(좌) + AI 채팅(우) 병렬 구조. docs/초안.md 7-②, 2026-08-05 설계 문서 참고.
export function CreateScreen({ socket, state }) {
  const [weaponState, setWeaponState] = useState({ parts: [] });
  const [weaponName, setWeaponName] = useState('');
  const [weaponMode, setWeaponMode] = useState('melee');
  const [phase, setPhase] = useState('editing'); // editing | evaluating | waiting
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stageRef = useRef(null);

  useEffect(() => {
    socket.on('create:progress', setProgress);
    return () => socket.off('create:progress', setProgress);
  }, [socket]);

  // 관리자가 "제작 완료 취소"를 누르면(실수로 평가받은 참가자 구제) 편집 화면으로 돌아간다.
  // weaponState/weaponName은 그대로 남아 있다 — waiting은 별도 화면이 아니라 이 컴포넌트의
  // phase일 뿐이라, 만들던 도형 배치가 그대로 캔버스에 복원된다.
  useEffect(() => {
    function onReopen() {
      state.weapon = null;
      setError(null);
      setNotice('진행자가 무기를 다시 고칠 수 있게 해줬어요. 수정한 뒤 다시 평가받아 주세요.');
      setPhase('editing');
    }
    socket.on('create:reopen', onReopen);
    return () => socket.off('create:reopen', onReopen);
  }, [socket, state]);

  async function evaluate() {
    setPhase('evaluating');
    setError(null);
    setNotice(null);
    let damage;
    let attackRange;
    let attackRangeDistance;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState, attackRange: weaponMode }),
      });
      if (!res.ok) throw new Error(`evaluate request failed with ${res.status}`);
      const data = await res.json();
      damage = data.damage;
      attackRange = data.attackRange;
      attackRangeDistance = data.attackRangeDistance;
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
      name: weaponName.trim().slice(0, WEAPON_NAME_MAX) || FALLBACK_WEAPON_NAME,
      image: previewImage,
      damage,
      attackRange,
      attackRangeDistance,
      parts: weaponState.parts,
    };
    state.weapon = weapon;
    setPhase('waiting');
    socket.emit('create:done', weapon);
  }

  if (phase === 'waiting') {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return html`
      <div class="card weapon-card">
        <p class="eyebrow">제작 완료</p>
        <div class="weapon-frame">
          ${state.weapon?.image
            ? html`<img src=${state.weapon.image} alt=${state.weapon?.name} />`
            : html`<span class="weapon-frame--empty">이미지 없음</span>`}
        </div>
        <h3 class="weapon-name">${state.weapon?.name}</h3>
        <p class="weapon-card-type">
          ${state.weapon?.attackRange === 'ranged' ? '원거리 무기 · 투사체 발사' : '근접 무기 · 휘두르기'}
        </p>
        <p class="weapon-card-damage">전투력 <strong>${state.weapon?.damage}</strong></p>
        <p class="weapon-card-status">
          다른 도전자를 기다리는 중<span class="dots"><i></i><i></i><i></i></span>
        </p>
        <div class="progress-track">
          <div class="progress-fill" style=${`width:${pct}%`}></div>
        </div>
        <p class="progress-label">${progress.done} / ${progress.total} 완료</p>
      </div>
    `;
  }

  const partCount = weaponState.parts.length;
  const busy = phase !== 'editing';

  return html`
    <div class="create-shell">
      <header class="create-header">
        <div>
          <p class="eyebrow">무기 제작소</p>
          <h2 class="create-title">도형을 조합해 나만의 무기를 만들어요</h2>
        </div>
        <span class="part-counter ${partCount >= MAX_PARTS ? 'is-full' : ''}">
          부품 ${partCount} / ${MAX_PARTS}
        </span>
      </header>

      <${CanvasEditor}
        parts=${weaponState.parts}
        onChange=${(parts) => setWeaponState({ parts })}
        onStageReady=${(stage) => {
          stageRef.current = stage;
        }}
        disabled=${busy}
      />
      <${ChatPanel}
        weaponState=${weaponState}
        onWeaponChange=${setWeaponState}
        disabled=${busy}
      />

      <div class="evaluate-panel">
        ${error ? html`<p class="evaluate-error">⚠ ${error}</p>` : null}
        ${notice ? html`<p class="evaluate-notice">↩ ${notice}</p>` : null}
        <div class="evaluate-row">
          <fieldset class="weapon-type-field" disabled=${busy}>
            <legend class="name-field-label">전투 방식</legend>
            <div class="weapon-type-options">
              <button
                type="button"
                class="weapon-type-btn ${weaponMode === 'melee' ? 'is-selected' : ''}"
                aria-pressed=${weaponMode === 'melee'}
                onClick=${() => setWeaponMode('melee')}
              >
                <strong>근접 무기</strong>
                <small>칼처럼 휘두르기</small>
              </button>
              <button
                type="button"
                class="weapon-type-btn ${weaponMode === 'ranged' ? 'is-selected' : ''}"
                aria-pressed=${weaponMode === 'ranged'}
                onClick=${() => setWeaponMode('ranged')}
              >
                <strong>원거리 무기</strong>
                <small>총알 발사하기</small>
              </button>
            </div>
          </fieldset>
          <label class="name-field">
            <span class="name-field-label">무기 이름</span>
            <input
              class="field"
              value=${weaponName}
              onInput=${(e) => setWeaponName(e.target.value)}
              maxlength=${WEAPON_NAME_MAX}
              disabled=${busy}
              placeholder="예: 시에르핀스키 창"
            />
          </label>
          <button
            class="btn btn--primary evaluate-btn ${phase === 'evaluating' ? 'is-loading' : ''}"
            onClick=${evaluate}
            disabled=${busy || partCount === 0}
          >
            ${phase === 'evaluating'
              ? html`<span class="btn-spinner"></span> 평가 중...`
              : 'AI 평가받기'}
          </button>
        </div>
        <p class="evaluate-hint">
          평가받으면 무기가 확정돼요 — 다시 고칠 수 없으니 완성한 뒤에 눌러주세요.
        </p>
      </div>
    </div>
  `;
}
