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
      if (!layer) return;

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

  const sorted = Object.values(players).sort((a, b) => b.score - a.score);

  return html`
    <div class="battle-map-view">
      <div class="battle-map-canvas" ref=${containerRef}></div>
      <ol class="leaderboard">
        ${sorted.map((p) => html`
          <li key=${p.id}>
            <span class="leaderboard-swatch" style=${{ background: CHARACTER_COLORS[p.characterId] ?? '#999' }}></span>
            <span class="leaderboard-name">${p.name || characterLabel(p.characterId)}</span>
            <span class="leaderboard-score">${p.score}</span>
          </li>
        `)}
      </ol>
    </div>
  `;
}
