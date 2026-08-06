import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { DEFAULT_MAP } from '../../../shapes/battleMap.js';
import { VirtualJoystick } from './VirtualJoystick.js';

const html = htm.bind(h);

const CHARACTER_RADIUS = 20;
// 화면에 실제로 보이는 영역(뷰포트) — 맵 전체 크기(DEFAULT_MAP.arenaSize, 지금 2176x1632)와는
// 별개로 고정이다. Konva Stage를 이 크기로 만들고, 카메라가 이 뷰포트 안에서 맵을 따라 움직인다.
const VIEWPORT_SIZE = { width: 800, height: 600 };

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
// CHARACTER_RADIUS(20)과 똑같이 하면 시에르핀스키/코흐눈꽃처럼 점이 많은 프랙탈은 뭉개져서
// 거의 안 보인다(Opus 리뷰에서 실측: 20px 아이콘에 43픽셀만 칠해짐) — 조금 더 키운다.
const WEAPON_ICON_SIZE = 28;
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};
// battle:input을 보낼지 말지 판단하는 임계값 — 연속값(moveX/moveY/aimX/aimY)은 불리언처럼
// 정확히 같은지 비교할 수 없어서, 이 값보다 작게 변하면 "그대로"로 본다(마우스 좌표가 1px만
// 흔들려도 매 프레임 emit되는 걸 방지).
const INPUT_EPSILON = 0.02;

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-06 배틀로얄 점수제/조작방식 재설계 문서 참고.
export function BattleScreen({ socket, state }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const stageRef = useRef(null);
  const nodesRef = useRef({});
  // PC 마우스 조준을 계산하려면 "내 캐릭터가 화면에서 어디 있는지"가 필요한데, battle:state로만
  // 갱신되는 서버 진실이라 여기 별도로 캐시해둔다(마우스 이벤트는 그 사이 계속 발생하므로).
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
  // 현재 카메라가 월드 좌표계에서 어디를 보고 있는지(뷰포트 왼쪽 위 모서리의 월드 좌표).
  // 마우스 조준 좌표 변환(뷰포트 좌표 -> 월드 좌표)에도 이 값이 필요해서 ref로 공유한다.
  const cameraRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
    stageRef.current = stage;

    // 배경 이미지 — 아직 파일이 없거나 로드에 실패해도(onerror) 아무 것도 하지 않고
    // .battle-arena의 어두운 배경색이 그대로 보이게 조용히 폴백한다(게임이 깨지면 안 됨).
    // cancelled 플래그: 로드가 끝나기 전에 화면이 언마운트되면(빠른 stage 전환 등) 이미
    // destroy된 stage/layer에 노드를 추가하지 않도록 막는다.
    let cancelled = false;
    const bgImage = new Image();
    bgImage.onload = () => {
      if (cancelled) return;
      const bg = new Konva.Image({
        image: bgImage,
        x: 0,
        y: 0,
        width: DEFAULT_MAP.arenaSize.width,
        height: DEFAULT_MAP.arenaSize.height,
      });
      layer.add(bg);
      bg.moveToBottom();
      layer.draw();
    };
    bgImage.onerror = () => {};
    bgImage.src = DEFAULT_MAP.imagePath;

    return () => {
      cancelled = true;
      stage.destroy();
    };
  }, []);

  useEffect(() => {
    function onState(room) {
      const layer = layerRef.current;
      if (!layer) return;

      // 벽은 배경 이미지에 실제 그림으로 이미 표현돼 있다고 가정하고, 여기서는 시각적으로
      // 그리지 않는다 — room.walls는 서버 충돌판정 전용 데이터.
      Object.values(room.players).forEach((p) => {
        if (p.id === socket.id) {
          selfPosRef.current = { x: p.x, y: p.y };
          updateCamera(p.x, p.y);
          // 마우스가 가만히 있어도 내 캐릭터는 서버 틱마다 움직이므로, "캐릭터 -> 마우스"
          // 조준 방향도 그때마다 다시 계산해야 한다 — mousemove 이벤트에서만 갱신하면
          // 이동 중엔 조준이 마지막으로 마우스가 움직였던 순간에 멈춰버린다(Opus 리뷰
          // Important I2). updateCamera가 먼저 실행돼서 cameraRef가 이 틱 기준으로
          // 최신 상태여야 아래 updateAimFromPointer의 좌표 변환이 정확하다.
          updateAimFromPointer();
        }
        let entry = nodesRef.current[p.id];
        if (!entry) {
          const isSelf = p.id === socket.id;
          const circle = new Konva.Circle({
            x: p.x, y: p.y, radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
            // 본인 캐릭터는 흰 테두리로 구분 — 다섯 명이 같은 화면에 있으면 어느 게 내 것인지
            // 색만으로는 구별하기 어려워서(설계 리뷰에서 지적됨).
            stroke: isSelf ? '#ffffff' : undefined,
            strokeWidth: isSelf ? 3 : 0,
          });
          // 탈락이 없는 점수제라 체력바 대신 현재 누적 점수를 숫자로 보여준다. moveOne이
          // 캐릭터를 y=CHARACTER_RADIUS까지 위로 붙게 허용하므로, 라벨을 그 위 18px에 그대로
          // 두면 위쪽 벽 근처에서 stage 밖(y<0)으로 잘려나간다 — 0으로 clamp(Opus 리뷰 Important I2).
          const scoreLabel = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: Math.max(0, p.y - CHARACTER_RADIUS - 18),
            width: CHARACTER_RADIUS * 2,
            text: String(p.score ?? 0),
            fontSize: 12, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          const label = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: p.y - 7,
            width: CHARACTER_RADIUS * 2,
            text: (p.characterId ?? '').replace('char', ''),
            fontSize: 14, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          // 참가자가 제작 화면에서 만든 무기를 작게 그려서 캐릭터 옆에 붙인다 — 무기는 대전 중
          // 안 바뀌므로(제작 단계에서 확정) 여기서 한 번만 그리고 이후엔 위치/회전만 옮긴다.
          const weaponGroup = drawWeaponGroup(Konva, p.weaponParts, { targetSize: WEAPON_ICON_SIZE });
          layer.add(circle);
          layer.add(scoreLabel);
          layer.add(label);
          layer.add(weaponGroup);
          entry = { circle, scoreLabel, label, weaponGroup };
          nodesRef.current[p.id] = entry;
        }
        // p.connected가 없는(구버전 상태 등 예상 밖) 프레임이 와도 전원이 흐려지지 않도록
        // 명시적으로 false일 때만 흐리게 — p.score ?? 0과 같은 방어 원칙(Opus 리뷰 Minor M2).
        const isConnected = p.connected !== false;
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        // 탈락이 없으므로 이 흐림 처리는 "죽음"이 아니라 "연결 끊김"만 의미한다.
        entry.circle.opacity(isConnected ? 1 : 0.2);
        entry.scoreLabel.x(p.x - CHARACTER_RADIUS);
        entry.scoreLabel.y(Math.max(0, p.y - CHARACTER_RADIUS - 18));
        entry.scoreLabel.text(String(p.score ?? 0));
        entry.scoreLabel.opacity(isConnected ? 1 : 0.2);
        entry.label.x(p.x - CHARACTER_RADIUS);
        entry.label.y(p.y - 7);
        entry.label.opacity(isConnected ? 1 : 0.2);

        // 무기 아이콘 위치/방향 — 조준 벡터(aimX/aimY)를 기준으로 캐릭터 중심에서 연속적으로
        // 오프셋되고, 그 각도만큼 회전한다(예전 4방향 스냅 대신 브롤스타즈처럼 자유 조준).
        // 벽 근처에서 아이콘이 화면 밖으로 잘리지 않게 아레나 범위 안으로 clamp —
        // dragBoundFunc(CanvasEditor.js)/moveOne(battleSimulation.js)과 같은 패턴.
        const aimX = p.aimX ?? 0;
        const aimY = p.aimY ?? 1;
        const WEAPON_OFFSET = CHARACTER_RADIUS;
        entry.weaponGroup.x(Math.min(DEFAULT_MAP.arenaSize.width, Math.max(0, p.x + aimX * WEAPON_OFFSET)));
        entry.weaponGroup.y(Math.min(DEFAULT_MAP.arenaSize.height, Math.max(0, p.y + aimY * WEAPON_OFFSET)));
        entry.weaponGroup.rotation((Math.atan2(aimY, aimX) * 180) / Math.PI);
        entry.weaponGroup.opacity(isConnected ? 1 : 0.2);
      });

      layer.draw();
    }
    socket.on('battle:state', onState);
    return () => socket.off('battle:state', onState);
  }, [socket]);

  useEffect(() => {
    function onResult({ win }) {
      state.battleResult = win ? 'win' : 'lose';
    }
    socket.on('battle:result', onResult);
    return () => socket.off('battle:result', onResult);
  }, [socket, state]);

  const inputRef = useRef({ moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });

  function sendInput(patch) {
    const next = { ...inputRef.current, ...patch };
    // 값이 임계값(INPUT_EPSILON) 이상 실제로 바뀔 때만 전송 — 마우스 이동처럼 아주 잦은
    // 이벤트가 매번 소켓으로 나가지 않게 한다(불리언 시절의 "값이 바뀔 때만 전송"과 같은
    // 원칙을 연속값에 맞게 확장).
    const changed = Object.keys(patch).some(
      (key) => Math.abs(inputRef.current[key] - next[key]) > INPUT_EPSILON,
    );
    if (!changed) return;
    inputRef.current = next;
    socket.emit('battle:input', inputRef.current);
  }

  // 키보드 이동 — WASD/화살표 둘 다 지원. 눌린 키 조합을 방향벡터로 합친 뒤 정규화해서
  // 보낸다(대각선 입력이 √2배 빨라지지 않게). 조준은 마우스가 담당하므로 여기서는 안 건드림.
  function updateMoveFromKeys() {
    const { up, down, left, right } = keysRef.current;
    let x = (right ? 1 : 0) - (left ? 1 : 0);
    let y = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    sendInput({ moveX: x, moveY: y });
  }

  useEffect(() => {
    function keyToDirection(key) {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
      if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
      if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
      return null;
    }
    function onKeyDown(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault(); // 방향키/WASD로 페이지가 스크롤/타이핑되는 것 방지
      if (e.repeat) return; // OS 키 반복은 무시
      keysRef.current = { ...keysRef.current, [dir]: true };
      updateMoveFromKeys();
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault();
      keysRef.current = { ...keysRef.current, [dir]: false };
      updateMoveFromKeys();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // PC 조준 — 아레나 위 마지막 마우스 위치와 내 캐릭터 위치(selfPosRef)의 차이를 방향벡터로
  // 보낸다. mousemove(마우스가 움직였을 때)뿐 아니라 battle:state 갱신(내 캐릭터가 움직였을
  // 때)에서도 호출된다 — 마우스가 가만히 있어도 캐릭터가 이동 중이면 조준 방향이 계속
  // 새로 계산돼야 하기 때문(Opus 리뷰 Important I2). mousedown(누르는 순간)은 그 시점의
  // 조준 방향으로 공격을 1회 발사한다 — 누르고 있어도 추가로 발사되지 않는다(쿨다운마다
  // 다시 클릭해야 함).
  // 카메라 — 내 캐릭터(월드 좌표 myX, myY)가 화면 중앙에 오도록 레이어를 이동시키되, 맵
  // 가장자리에서는 그 이상 못 밀리게 clamp한다. cameraRef에 저장해두는 이유는
  // updateAimFromPointer가 뷰포트 좌표를 월드 좌표로 되돌릴 때 이 값이 필요하기 때문.
  function updateCamera(myX, myY) {
    const layer = layerRef.current;
    if (!layer) return;
    const maxX = Math.max(0, DEFAULT_MAP.arenaSize.width - VIEWPORT_SIZE.width);
    const maxY = Math.max(0, DEFAULT_MAP.arenaSize.height - VIEWPORT_SIZE.height);
    const cameraX = clamp(myX - VIEWPORT_SIZE.width / 2, 0, maxX);
    const cameraY = clamp(myY - VIEWPORT_SIZE.height / 2, 0, maxY);
    cameraRef.current = { x: cameraX, y: cameraY };
    layer.x(-cameraX);
    layer.y(-cameraY);
  }

  function updateAimFromPointer() {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const { x: sx, y: sy } = selfPosRef.current;
    // getPointerPosition()은 뷰포트(스테이지) 기준 좌표(0~800, 0~600)를 반환한다 —
    // 카메라 오프셋을 더해서 월드 좌표로 변환한 뒤에야 내 캐릭터(월드 좌표)와 정확히
    // 비교할 수 있다. 안 그러면 카메라가 원점(0,0)에서 벗어나는 순간 조준 방향이 어긋난다.
    const { x: camX, y: camY } = cameraRef.current;
    const worldPointerX = pointer.x + camX;
    const worldPointerY = pointer.y + camY;
    const dx = worldPointerX - sx;
    const dy = worldPointerY - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return; // 캐릭터 위치와 거의 겹치면(1px 미만) 조준을 갱신하지 않음
    sendInput({ aimX: dx / len, aimY: dy / len });
  }

  useEffect(() => {
    function onMouseDown(e) {
      if (e.button !== 0) return; // 좌클릭만 공격으로 취급(우클릭 컨텍스트 메뉴 등은 무시)
      socket.emit('battle:attack');
    }
    const el = containerRef.current;
    el?.addEventListener('mousemove', updateAimFromPointer);
    el?.addEventListener('mousedown', onMouseDown);
    return () => {
      el?.removeEventListener('mousemove', updateAimFromPointer);
      el?.removeEventListener('mousedown', onMouseDown);
    };
  }, [socket]);

  function onMoveStick({ x, y }) {
    sendInput({ moveX: x, moveY: y });
  }
  function onAimStick({ x, y }) {
    // 스틱이 중앙 근처(길이 거의 0)면 조준을 보내지 않는다 — 서버의 데드존과 같은 이유로,
    // 손을 떼는 순간 조준이 (0,0)으로 무너져 공격 위치가 캐릭터 자기 자신으로 붕괴하는 것 방지.
    const len = Math.hypot(x, y);
    if (len < 0.05) return;
    // 스틱 벡터를 그대로 보내면 살짝 민 입력(길이가 짧음)일수록 각도 변화 감지 임계값
    // (INPUT_EPSILON)을 넘기려면 더 큰 각도 변화가 필요해져 조준이 뭉툭해진다 — PC 마우스
    // 조준(단위벡터)과 똑같이 정규화해서 보낸다(Opus 리뷰 Important I5).
    sendInput({ aimX: x / len, aimY: y / len });
  }
  function onAimRelease() {
    socket.emit('battle:attack');
  }

  return html`
    <div class="battle-shell" style=${{ '--arena-width': `${DEFAULT_MAP.arenaSize.width}px` }}>
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <${VirtualJoystick} onChange=${onMoveStick} />
        <${VirtualJoystick} onChange=${onAimStick} onRelease=${onAimRelease} className="aim" />
      </div>
    </div>
  `;
}
