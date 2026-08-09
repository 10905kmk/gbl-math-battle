import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';

const html = htm.bind(h);

// 공용화면 전용 고정 크기 — 월드(DEFAULT_MAP.arenaSize)와 같은 4:3 비율로 축소해서 보여준다.
// 참가자 화면의 뷰포트(800x600, 카메라 추적용)와는 다른 목적이라 별도 상수를 둔다 — 여긴
// 카메라 없이 맵 전체를 한 번에 보여주는 관전자 시점이다.
const DISPLAY_MAP_SIZE = { width: 800, height: 600 };
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

// frontend/src/screens/battle.js의 formatTimeRemaining과 같은 로직 — CHARACTER_COLORS와
// 같은 이유(위 주석 참고)로 공유 모듈로 빼지 않고 그대로 복제했다.
function formatTimeRemaining(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function BattleMapView({ socket }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const nodesRef = useRef({});
  const [players, setPlayers] = useState({});
  const [remainingMs, setRemainingMs] = useState(null);
  const [roundStatus, setRoundStatus] = useState('roulette');
  const [pickedCount, setPickedCount] = useState(0);
  const [countdownSec, setCountdownSec] = useState(null);

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

      setRoundStatus(room.status);
      setCountdownSec(
        room.status === 'countdown' && Number.isFinite(room.countdownEndsAt)
          ? Math.max(1, Math.ceil((room.countdownEndsAt - Date.now()) / 1000))
          : null,
      );
      const connected = Object.values(room.players).filter((p) => p.connected !== false);
      setPickedCount(connected.filter((p) => Boolean(p.skillId)).length);

      if (Number.isFinite(room.endsAt)) {
        setRemainingMs(Math.max(0, room.endsAt - Date.now()));
      }

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
        // 연결이 끊겼거나 죽어서 부활 대기 중이면 흐리게 — 참가자 화면(battle.js)과 같은 규칙.
        node.opacity(p.connected === false ? 0.2 : p.alive === false ? 0.28 : 1);
      });

      layer.draw();
      // 리더보드는 Konva가 아니라 일반 DOM으로 그린다 — 텍스트 목록이라 캔버스를 쓸 이유가
      // 없고, 정렬된 목록을 매번 다시 그리는 게 DOM이 훨씬 간단하다.
      setPlayers(room.players);
    }
    socket.on('battle:state', onState);
    socket.emit('battle:requestSync');
    return () => socket.off('battle:state', onState);
  }, [socket]);

  // 점수는 더 이상 플레이어에 저장된 값이 아니라 킬/데스/어시스트에서 파생된다
  // (battleSimulation.computeScore와 같은 식). 서버가 그때그때 계산해 보내지 않으므로
  // 공용화면도 같은 식으로 직접 계산한다 — 두 화면의 순위가 어긋나면 안 되므로 계수는
  // 반드시 서버와 같은 값이어야 한다(킬 +20 / 데스 -10 / 어시 +5).
  const scoreOf = (p) => (p.kills ?? 0) * 20 + (p.deaths ?? 0) * -10 + (p.assists ?? 0) * 5;
  const sorted = Object.values(players).sort((a, b) => scoreOf(b) - scoreOf(a) || (b.kills ?? 0) - (a.kills ?? 0));
  const battleGuide = roundStatus === 'roulette'
    ? { title: '특수 스킬을 선택하세요', text: `참가자 화면에서 3개 중 1개 선택 · ${pickedCount}/${sorted.length}명 완료` }
    : roundStatus === 'countdown'
      ? { title: '곧 전투가 시작됩니다', text: '화면을 보고 준비하세요' }
      : roundStatus === 'active'
        ? { title: '기하학 무기 배틀 진행 중', text: '이동하며 조준하고 공격하세요 · 킬 +20 / 데스 -10 / 어시스트 +5' }
        : { title: '라운드 종료', text: '순위표를 확인하고 진행자의 안내를 기다려 주세요' };
  return html`
    <main class="battle-display">
      <header class="battle-guide-bar">
        <div>
          <strong>${battleGuide.title}</strong>
          <span>${battleGuide.text}</span>
        </div>
      </header>
      <div class="battle-map-view">
        <div class="battle-map-wrap">
          <div class="battle-map-canvas" ref=${containerRef}></div>
          ${roundStatus === 'active' && remainingMs !== null && html`<div class="battle-map-timer">${formatTimeRemaining(remainingMs)}</div>`}
          ${roundStatus === 'roulette'
            ? html`<div class="battle-map-overlay"><strong>특수 스킬 선택</strong><span>내 화면에서 원하는 스킬 하나를 눌러 주세요</span></div>`
            : null}
          ${roundStatus === 'countdown'
            ? html`<div class="battle-map-overlay battle-map-overlay--countdown"><strong>${countdownSec ?? 'READY'}</strong><span>전투 준비!</span></div>`
            : null}
        </div>
        <ol class="leaderboard">
          ${sorted.map((p, i) => {
            const isConnected = p.connected !== false;
            return html`
              <li key=${p.id} class=${isConnected ? '' : 'leaderboard-disconnected'}>
                <span class="leaderboard-rank">${i + 1}</span>
                <span class="leaderboard-swatch" style=${{ background: CHARACTER_COLORS[p.characterId] ?? '#999' }}></span>
                <span class="leaderboard-name">${p.name || characterLabel(p.characterId)}</span>
                <span class="leaderboard-kda">${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}</span>
                <span class="leaderboard-score">${scoreOf(p)}</span>
              </li>
            `;
          })}
        </ol>
      </div>
    </main>
  `;
}
