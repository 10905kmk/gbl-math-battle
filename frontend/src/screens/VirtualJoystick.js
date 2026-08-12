import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 스틱 중심에서 이만큼(px) 벗어나면 벡터 길이가 1로 clamp된다.
const DEFAULT_RADIUS = 40;

// 터치/마우스 드래그로 -1~1 범위의 2D 벡터를 만들어내는 가상 스틱. onRelease는
// 듀얼 조이스틱 모드에서 빨간 조준 스틱을 놓는 순간 공격하는 용도로 사용한다.
export function VirtualJoystick({ radius = DEFAULT_RADIUS, onChange, onRelease, className = '' }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const draggingRef = useRef(false);
  // 지금 스틱을 조작 중인 손가락의 pointerId만 추적한다 — 안 그러면 이미 누르고 있는 스틱에
  // 두 번째 손가락이 닿았을 때 그쪽으로 조작이 넘어가버리고, 첫 손가락을 떼는 순간(pointerup)
  // 스틱이 통째로 리셋되면서 여전히 붙어 있는 두 번째 손가락의 움직임은 무시된다(Opus 리뷰
  // Important I4).
  const activeIdRef = useRef(null);

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
    if (draggingRef.current) return; // 이미 다른 손가락이 조작 중이면 무시
    draggingRef.current = true;
    activeIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 드문 경우(예: 이미 무효화된 pointerId) 캡처만 실패할 뿐이므로, 위치 갱신은
      // 그대로 진행한다 — 캡처 실패로 입력 자체를 잃을 이유는 없다.
    }
    updateFromClientPos(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!draggingRef.current || e.pointerId !== activeIdRef.current) return;
    updateFromClientPos(e.clientX, e.clientY);
  }
  // pointerup뿐 아니라 pointerleave/pointercancel에서도 같은 방식으로 손 뗌 처리 —
  // 터치 중 손가락이 스틱 밖으로 미끄러지면 pointerup이 아니라 그쪽 이벤트가 발생한다
  // (기존 D-pad 버튼의 releaseOn과 같은 이유).
  function onPointerUp(e) {
    if (!draggingRef.current || e.pointerId !== activeIdRef.current) return;
    draggingRef.current = false;
    activeIdRef.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
    onChange({ x: 0, y: 0 });
    onRelease?.();
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
