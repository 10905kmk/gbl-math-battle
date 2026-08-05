import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';

const html = htm.bind(h);

const ARENA_SIZE = { width: 800, height: 600 };
const CHARACTER_RADIUS = 20;
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
};

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-05 대전 시스템 설계 문서 참고.
export function BattleScreen({ socket, state }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const nodesRef = useRef({});

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: ARENA_SIZE.width,
      height: ARENA_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
    return () => stage.destroy();
  }, []);

  useEffect(() => {
    function onState(room) {
      const layer = layerRef.current;
      if (!layer) return;

      if (layer.find('.wall').length === 0) {
        room.walls.forEach((w) => {
          layer.add(new Konva.Rect({ x: w.x, y: w.y, width: w.width, height: w.height, fill: '#555', name: 'wall' }));
        });
      }

      Object.values(room.players).forEach((p) => {
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
          const hpBar = new Konva.Rect({
            x: p.x - CHARACTER_RADIUS, y: p.y - CHARACTER_RADIUS - 8,
            width: CHARACTER_RADIUS * 2, height: 4, fill: '#2ecc71',
          });
          const label = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: p.y - 7,
            width: CHARACTER_RADIUS * 2,
            text: (p.characterId ?? '').replace('char', ''),
            fontSize: 14, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          layer.add(circle);
          layer.add(hpBar);
          layer.add(label);
          entry = { circle, hpBar, label };
          nodesRef.current[p.id] = entry;
        }
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        entry.circle.opacity(p.alive ? 1 : 0.2);
        entry.hpBar.x(p.x - CHARACTER_RADIUS);
        entry.hpBar.y(p.y - CHARACTER_RADIUS - 8);
        entry.hpBar.width(CHARACTER_RADIUS * 2 * Math.max(0, p.hp / 100));
        entry.label.x(p.x - CHARACTER_RADIUS);
        entry.label.y(p.y - 7);
        entry.label.opacity(p.alive ? 1 : 0.2);
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

  const inputRef = useRef({ up: false, down: false, left: false, right: false, attack: false });

  function sendInput(patch) {
    const next = { ...inputRef.current, ...patch };
    // 값이 실제로 바뀔 때만 전송 — 특히 키보드 반복입력(OS auto-repeat)이 초당 수십 번
    // 동일한 keydown을 발생시켜도 여기서 걸러지므로 서버로 불필요한 이벤트가 안 나간다.
    const changed = Object.keys(patch).some((key) => inputRef.current[key] !== next[key]);
    if (!changed) return;
    inputRef.current = next;
    socket.emit('battle:input', inputRef.current);
  }

  useEffect(() => {
    function keyToDirection(key) {
      if (key === 'ArrowUp') return 'up';
      if (key === 'ArrowDown') return 'down';
      if (key === 'ArrowLeft') return 'left';
      if (key === 'ArrowRight') return 'right';
      if (key === ' ') return 'attack';
      return null;
    }
    function onKeyDown(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault(); // 방향키/스페이스바로 페이지가 스크롤되는 것 방지
      if (e.repeat) return; // OS 키 반복은 무시 (sendInput의 변경감지와 이중 방어)
      sendInput({ [dir]: true });
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault();
      sendInput({ [dir]: false });
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 방향패드/공격 버튼 공용 핸들러 — 터치로 누르고 있다가 손가락이 버튼 밖으로 미끄러지면
  // pointerup이 아니라 pointerleave/pointercancel이 발생해서, 그 경우도 놓치지 않고 떼야
  // "버튼에서 손을 뗐는데 캐릭터가 계속 움직이는" 상태가 안 생긴다.
  function releaseOn(key) {
    return () => sendInput({ [key]: false });
  }
  function pressOn(key) {
    return () => sendInput({ [key]: true });
  }

  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <div class="dpad">
          <button
            onPointerDown=${pressOn('up')}
            onPointerUp=${releaseOn('up')}
            onPointerLeave=${releaseOn('up')}
            onPointerCancel=${releaseOn('up')}
          >↑</button>
          <div class="dpad-row">
            <button
              onPointerDown=${pressOn('left')}
              onPointerUp=${releaseOn('left')}
              onPointerLeave=${releaseOn('left')}
              onPointerCancel=${releaseOn('left')}
            >←</button>
            <button
              onPointerDown=${pressOn('down')}
              onPointerUp=${releaseOn('down')}
              onPointerLeave=${releaseOn('down')}
              onPointerCancel=${releaseOn('down')}
            >↓</button>
            <button
              onPointerDown=${pressOn('right')}
              onPointerUp=${releaseOn('right')}
              onPointerLeave=${releaseOn('right')}
              onPointerCancel=${releaseOn('right')}
            >→</button>
          </div>
        </div>
        <button
          class="attack-button"
          onPointerDown=${pressOn('attack')}
          onPointerUp=${releaseOn('attack')}
          onPointerLeave=${releaseOn('attack')}
          onPointerCancel=${releaseOn('attack')}
        >공격</button>
      </div>
    </div>
  `;
}
