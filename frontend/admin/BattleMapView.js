import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';

const html = htm.bind(h);

// 공용화면 전용 고정 크기 — 월드(DEFAULT_MAP.arenaSize)와 같은 4:3 비율로 축소해서 보여준다.
// 참가자 화면의 뷰포트(800x600, 카메라 추적용)와는 다른 목적이라 별도 상수를 둔다 — 여긴
// 카메라 없이 맵 전체를 한 번에 보여주는 관전자 시점이다.
const DISPLAY_MAP_SIZE = { width: 960, height: 720 };
const SCALE = DISPLAY_MAP_SIZE.width / DEFAULT_MAP.arenaSize.width;
const CHARACTER_RADIUS = 6; // 미니맵이라 참가자 화면(20)보다 작게 그린다

// frontend/src/screens/battle.js의 CHARACTER_COLORS와 같은 값 — 공유 모듈로 빼지 않고 그대로
// 복제했다(그 파일이 다른 작업으로 자주 바뀌는 중이라 충돌을 피하려는 목적, 8개 고정값이라
// 중복돼도 드리프트 위험이 낮음).
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};

function characterLabel(characterId) {
  return `캐릭터 ${(characterId ?? '').replace('char', '')}`;
}

export function BattleMapView({ socket }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const nodesRef = useRef({});
  const [players, setPlayers] = useState({});

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: DISPLAY_MAP_SIZE.width,
      height: DISPLAY_MAP_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;

    // 배경 이미지 — 참가자 화면과 같은 이유로, 없거나 로드 실패해도 조용히 어두운 배경으로
    // 폴백한다(게임/화면이 깨지면 안 됨).
    let cancelled = false;
    const bgImage = new Image();
    bgImage.onload = () => {
      if (cancelled) return;
      const bg = new Konva.Image({
        image: bgImage, x: 0, y: 0,
        width: DISPLAY_MAP_SIZE.width, height: DISPLAY_MAP_SIZE.height,
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
      if (!layer || !room?.players) return;

      Object.values(room.players).forEach((p) => {
        let node = nodesRef.current[p.id];
        if (!node) {
          node = new Konva.Circle({
            radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
          });
          layer.add(node);
          nodesRef.current[p.id] = node;
        }
        node.x(p.x * SCALE);
        node.y(p.y * SCALE);
        node.opacity(p.connected !== false ? 1 : 0.2);
      });

      layer.draw();
      // 리더보드는 Konva가 아니라 일반 DOM으로 그린다 — 텍스트 목록이라 캔버스를 쓸 이유가
      // 없고, 정렬된 목록을 매번 다시 그리는 게 DOM이 훨씬 간단하다.
      setPlayers(room.players);
    }
    socket.on('battle:state', onState);
    return () => socket.off('battle:state', onState);
  }, [socket]);

  // score ?? 0 — 이 프로젝트 전반의 방어 원칙(connected !== false 등)과 같은 이유. score가
  // 하나라도 undefined면 비교식이 NaN이 되어 목록 전체 순서가 조용히 뒤섞인다(Opus 리뷰
  // Minor M4 — 지금은 battle.js가 항상 0으로 초기화해서 안 걸리지만, 방어선을 하나만 두지
  // 않는다는 이 프로젝트의 원칙을 따른다).
  const sorted = Object.values(players).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return html`
    <div class="battle-map-view">
      <div class="battle-map-canvas" ref=${containerRef}></div>
      <ol class="leaderboard">
        ${sorted.map((p, i) => {
          const isConnected = p.connected !== false;
          return html`
            <li key=${p.id} class=${isConnected ? '' : 'leaderboard-disconnected'}>
              <span class="leaderboard-rank">${i + 1}</span>
              <span class="leaderboard-swatch" style=${{ background: CHARACTER_COLORS[p.characterId] ?? '#999' }}></span>
              <span class="leaderboard-name">${p.name || characterLabel(p.characterId)}</span>
              <span class="leaderboard-score">${p.score ?? 0}</span>
            </li>
          `;
        })}
      </ol>
    </div>
  `;
}
