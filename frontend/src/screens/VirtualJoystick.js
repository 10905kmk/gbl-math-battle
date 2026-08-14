import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 스틱 중심에서 이만큼(px) 벗어나면 벡터 길이가 1로 clamp된다.
const DEFAULT_RADIUS = 40;

// 터치/마우스 드래그로 -1~1 범위의 2D 벡터를 만들어내는 가상 스틱. onRelease는
// 듀얼 조이스틱 모드에서 빨간 조준 스틱을 놓는 순간 공격하는 용도로 사용한다.
//
// 손가락을 누르는 지점에 스틱이 그대로 나타나는 방식(브롤스타즈 방식) — 실제 터치 판정은
// 눈에 보이는 원(.joystick-base)이 아니라 그보다 넓은 .joystick-hit-area가 받는다. 누른
// 지점을 clamp 없이 그대로 base의 중심으로 쓰므로, hit-area 가장자리를 누르면 base가
// zone 밖으로 삐져나와 보일 수 있다 — "누른 곳이 곧 중심"이 우선이라 의도한 동작이다.
// .joystick-zone 자체는 원래 .joystick-base와 같은 크기를 유지한다(position:absolute인
// hit-area/base는 레이아웃에 영향을 주지 않으므로) — 터치 영역만 눈에 안 보이게 넓혀도
// .battle-controls의 실제 높이는 늘어나지 않는다.
export function VirtualJoystick({ radius = DEFAULT_RADIUS, onChange, onRelease, className = '' }) {
  const zoneRef = useRef(null);
  const hitAreaRef = useRef(null);
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const draggingRef = useRef(false);
  // 지금 스틱을 조작 중인 손가락의 pointerId만 추적한다 — 안 그러면 이미 누르고 있는 스틱에
  // 두 번째 손가락이 닿았을 때 그쪽으로 조작이 넘어가버리고, 첫 손가락을 떼는 순간(pointerup)
  // 스틱이 통째로 리셋되면서 여전히 붙어 있는 두 번째 손가락의 움직임은 무시된다(Opus 리뷰
  // Important I4).
  const activeIdRef = useRef(null);

  // base를 누른 지점(clientX/clientY)에 그대로 옮긴다 — clamp하지 않는다. 누른 지점이
  // hit-area 가장자리 쪽이면 base(원)가 zone/hit-area 밖으로 삐져나오게 그려질 수 있지만
  // (zone/hit-area 둘 다 overflow를 안 걸어서 잘리지 않음), "누른 지점이 그대로 중심이
  // 된다"는 게 우선이라 일부러 안 막는다(사용자 피드백, 2026-08-14). left/top을 base의
  // 부모(zone) 기준 px로 주면 CSS의 transform:translate(-50%,-50%)가 그 지점을 중심에
  // 맞춰준다.
  function positionBaseAt(clientX, clientY) {
    const zone = zoneRef.current;
    if (!zone) return;
    const zoneRect = zone.getBoundingClientRect();
    const base = baseRef.current;
    if (base) {
      base.style.left = `${clientX - zoneRect.left}px`;
      base.style.top = `${clientY - zoneRect.top}px`;
    }
  }

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
    baseRef.current?.classList.add('is-dragging');
    positionBaseAt(e.clientX, e.clientY);
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
    if (baseRef.current) {
      baseRef.current.classList.remove('is-dragging');
      // zone 중앙(기본 위치)으로 되돌린다 — CSS의 left:50%/top:50%가 다시 적용된다.
      baseRef.current.style.left = '';
      baseRef.current.style.top = '';
    }
    onChange({ x: 0, y: 0 });
    onRelease?.();
  }

  return html`
    <div class="joystick-zone" ref=${zoneRef}>
      <div
        class="joystick-hit-area"
        ref=${hitAreaRef}
        onPointerDown=${onPointerDown}
        onPointerMove=${onPointerMove}
        onPointerUp=${onPointerUp}
        onPointerLeave=${onPointerUp}
        onPointerCancel=${onPointerUp}
      ></div>
      <div class="joystick-base ${className}" ref=${baseRef}>
        <div class="joystick-knob" ref=${knobRef}></div>
      </div>
    </div>
  `;
}
