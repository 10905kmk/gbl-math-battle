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
// 입력 처리(방향패드/키보드)는 Task 8에서 추가 — 이 태스크는 상태 수신 + 렌더링까지만.
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
          const circle = new Konva.Circle({
            x: p.x, y: p.y, radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
          });
          const hpBar = new Konva.Rect({
            x: p.x - CHARACTER_RADIUS, y: p.y - CHARACTER_RADIUS - 8,
            width: CHARACTER_RADIUS * 2, height: 4, fill: '#2ecc71',
          });
          layer.add(circle);
          layer.add(hpBar);
          entry = { circle, hpBar };
          nodesRef.current[p.id] = entry;
        }
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        entry.circle.opacity(p.alive ? 1 : 0.2);
        entry.hpBar.x(p.x - CHARACTER_RADIUS);
        entry.hpBar.y(p.y - CHARACTER_RADIUS - 8);
        entry.hpBar.width(CHARACTER_RADIUS * 2 * Math.max(0, p.hp / 100));
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
    inputRef.current = { ...inputRef.current, ...patch };
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
      if (dir) sendInput({ [dir]: true });
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (dir) sendInput({ [dir]: false });
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <div class="dpad">
          <button
            onPointerDown=${() => sendInput({ up: true })}
            onPointerUp=${() => sendInput({ up: false })}
          >↑</button>
          <div class="dpad-row">
            <button
              onPointerDown=${() => sendInput({ left: true })}
              onPointerUp=${() => sendInput({ left: false })}
            >←</button>
            <button
              onPointerDown=${() => sendInput({ down: true })}
              onPointerUp=${() => sendInput({ down: false })}
            >↓</button>
            <button
              onPointerDown=${() => sendInput({ right: true })}
              onPointerUp=${() => sendInput({ right: false })}
            >→</button>
          </div>
        </div>
        <button
          class="attack-button"
          onPointerDown=${() => sendInput({ attack: true })}
          onPointerUp=${() => sendInput({ attack: false })}
        >공격</button>
      </div>
    </div>
  `;
}
