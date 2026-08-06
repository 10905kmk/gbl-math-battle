import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 스틱 중심에서 이만큼(px) 벗어나면 벡터 길이가 1로 clamp된다.
const DEFAULT_RADIUS = 40;

// 터치/마우스 드래그로 -1~1 범위의 2D 벡터를 만들어내는 가상 스틱. 이동 스틱과 조준
// 스틱 양쪽에서 재사용한다(브롤스타즈 스타일 듀얼스틱, 2026-08-06 조작방식 재설계 스펙) —
// 조준 스틱은 onRelease로 "손을 뗀 순간"을 추가로 받아 battle.js가 그 시점에 공격을
// 트리거하는 데 쓴다.
export function VirtualJoystick({ radius = DEFAULT_RADIUS, onChange, onRelease, className = '' }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const draggingRef = useRef(false);

  function updateFromClientPos(clientX, clientY) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let x = (clientX - cx) / radius;
    let y = (clientY - cy) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    }
    onChange({ x, y });
  }

  function onPointerDown(e) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientPos(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    updateFromClientPos(e.clientX, e.clientY);
  }
  // pointerup뿐 아니라 pointerleave/pointercancel에서도 같은 방식으로 손 뗌 처리 —
  // 터치 중 손가락이 스틱 밖으로 미끄러지면 pointerup이 아니라 그쪽 이벤트가 발생한다
  // (기존 D-pad 버튼의 releaseOn과 같은 이유).
  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
    onChange({ x: 0, y: 0 });
    if (onRelease) onRelease();
  }

  return html`
    <div
      class="joystick-base ${className}"
      ref=${baseRef}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${onPointerUp}
      onPointerLeave=${onPointerUp}
      onPointerCancel=${onPointerUp}
    >
      <div class="joystick-knob" ref=${knobRef}></div>
    </div>
  `;
}
