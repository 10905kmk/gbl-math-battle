import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { DEFAULT_MAP } from '../../../shapes/battleMap.js';
import { meleeHitboxRect, ATTACK_HITBOX_SIZE, PROJECTILE_RADIUS } from '../../../shapes/attackGeometry.js';
import { MAX_HP } from '../../../shapes/combatRules.js';
import { VirtualJoystick } from './VirtualJoystick.js';
import { SkillRoulette } from './battle/SkillRoulette.js';
import { SkillButton } from './battle/SkillButton.js';
import { clearSkillEffects, drawSkillEffects, isPlayerHiddenByCloak } from './battle/skillEffects.js';
import { hasLocalDamage } from './battle/battleFeedback.js';

const html = htm.bind(h);

const CHARACTER_RADIUS = 20;
// 화면에 실제로 보이는 영역(뷰포트) — 맵 전체 크기(DEFAULT_MAP.arenaSize, 지금 2176x1632)와는
// 별개로 고정이다. Konva Stage를 이 크기로 만들고, 카메라가 이 뷰포트 안에서 맵을 따라 움직인다.
const VIEWPORT_SIZE = { width: 800, height: 600 };

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// room.endsAt(서버 시각 기준 종료 시점)까지 남은 시간을 "M:SS"로 포맷 — Math.ceil을 써서
// 599ms 남았을 때도 "0:01"로 보이게 한다(Math.floor면 남은 시간이 그대로 있는데도 한 박자
// 일찍 0:00으로 보임). 음수(서버 응답이 살짝 늦게 도착하는 경우 등)는 0으로 방어.
function formatTimeRemaining(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
// CHARACTER_RADIUS(20)과 똑같이 하면 시에르핀스키/코흐눈꽃처럼 점이 많은 프랙탈은 뭉개져서
// 거의 안 보인다(Opus 리뷰에서 실측: 20px 아이콘에 43픽셀만 칠해짐) — 조금 더 키운다.
const WEAPON_ICON_SIZE = 28;
// 머리 위 체력바 — 서버의 HP_MAX(backend/lib/battleSimulation.js가 재수출)와 같은
// shapes/combatRules.js를 그대로 가져다 쓴다. 밸런스 조정으로 MAX_HP가 바뀌어도
// 이 값이 조용히 서버와 어긋날 일이 없다(Opus 리뷰 Minor #10, 2026-08-10).
const HP_MAX_CLIENT = MAX_HP;
const HP_BAR_WIDTH = 42;
const HP_BAR_HEIGHT = 6;
const HP_COLOR_FULL = '#5fe3a1';
const HP_COLOR_MID = '#ffd66e';
const HP_COLOR_LOW = '#ff6b6b';
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};
// battle:input을 보낼지 말지 판단하는 임계값 — 연속값(moveX/moveY/aimX/aimY)은 불리언처럼
// 정확히 같은지 비교할 수 없어서, 이 값보다 작게 변하면 "그대로"로 본다(마우스 좌표가 1px만
// 흔들려도 매 프레임 emit되는 걸 방지).
const INPUT_EPSILON = 0.02;
const NETWORK_FRAME_MS = 50;

function sameArray(a, b) {
  return a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]));
}

function sameNumberRecord(a, b) {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-06 배틀로얄 점수제/조작방식 재설계 문서 참고.
export function BattleScreen({ socket, state }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const stageRef = useRef(null);
  const nodesRef = useRef({});
  // 투사체는 플레이어와 달리 계속 생겼다 없어지므로 별도로 관리한다(id별 Konva 노드).
  const projectileNodesRef = useRef({});
  // 서버는 안정적인 20틱 판정을 유지하고, 수신한 두 위치 사이를 브라우저의
  // requestAnimationFrame(Konva.Animation, 보통 60Hz)으로 보간해 50FPS 이상으로 보인다.
  const motionTargetsRef = useRef(new Map());
  const hitFlashUntilRef = useRef(0);
  const hitFlashTimerRef = useRef(null);
  // 내 캐릭터의 공격 미리보기(텔레그래프) 노드 — 무기 종류(근접 Rect/원거리 Line)는 대전
  // 중 안 바뀌므로 한 번만 만들고 이후 위치만 갱신한다.
  const previewNodeRef = useRef(null);
  // PC 마우스 조준을 계산하려면 "내 캐릭터가 화면에서 어디 있는지"가 필요한데, battle:state로만
  // 갱신되는 서버 진실이라 여기 별도로 캐시해둔다(마우스 이벤트는 그 사이 계속 발생하므로).
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
  // 현재 카메라가 월드 좌표계에서 어디를 보고 있는지(뷰포트 왼쪽 위 모서리의 월드 좌표).
  // 마우스 조준 좌표 변환(뷰포트 좌표 -> 월드 좌표)에도 이 값이 필요해서 ref로 공유한다.
  const cameraRef = useRef({ x: 0, y: 0 });
  // endsAt/쿨타임은 서버 시각이다. 참가자 기기의 시계가 빠르거나 느려도 파티클이 즉시
  // 사라지지 않도록 매 상태 패킷의 serverNow로 현재 서버 시각을 복원한다.
  const serverClockOffsetRef = useRef(0);
  // 제한시간 HUD는 Konva 캔버스가 아니라 일반 DOM 텍스트라 useState로 관리 — battle:state가
  // 50ms마다 오므로 이 값도 그 주기로 갱신되어 카운트다운이 매끄럽게 보인다.
  const [remainingMs, setRemainingMs] = useState(null);
  // 라운드 상태(countdown | active | ended)와 시작 카운트다운 남은 초 — 둘 다 DOM 오버레이용.
  const [roundStatus, setRoundStatus] = useState('countdown');
  const [countdownSec, setCountdownSec] = useState(null);
  // 내 캐릭터가 죽어 있을 때 남은 부활 시간(초). 살아 있으면 null.
  const [respawnSec, setRespawnSec] = useState(null);
  // 판이 끝나면 서버가 보내주는 최종 순위표. null이면 대시보드를 안 그린다.
  const [standings, setStandings] = useState(null);
  const [hitFlashPulse, setHitFlashPulse] = useState(0);
  // 특수 스킬 — 룰렛 후보 9개, 내가 고른 4개, 스킬별 쿨타임.
  const [skillChoices, setSkillChoices] = useState([]);
  const [mySkillIds, setMySkillIds] = useState([]);
  const [skillsConfirmed, setSkillsConfirmed] = useState(false);
  const [skillReadyAts, setSkillReadyAts] = useState({});

  function moveNodeSmoothly(node, x, y, immediate = false) {
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (immediate) {
      motionTargetsRef.current.delete(node);
      node.position({ x, y });
      return;
    }
    motionTargetsRef.current.set(node, {
      fromX: node.x(), fromY: node.y(),
      toX: x, toY: y,
      startedAt: performance.now(),
    });
  }

  useEffect(() => {
    // 이전 게임 화면/개발자 조종 아바타의 Konva 레이어에 속했던 파티클 캐시를 비운다.
    // 이걸 남겨두면 새 캔버스에서 같은 id의 파티클을 이미 있다고 착각해 그리지 않는다.
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
    stageRef.current = stage;
    const motionAnimation = new Konva.Animation(() => {
      const now = performance.now();
      for (const [node, motion] of motionTargetsRef.current) {
        const t = Math.min(1, Math.max(0, (now - motion.startedAt) / NETWORK_FRAME_MS));
        node.position({
          x: motion.fromX + (motion.toX - motion.fromX) * t,
          y: motion.fromY + (motion.toY - motion.fromY) * t,
        });
        if (t >= 1) motionTargetsRef.current.delete(node);
      }
    }, layer);
    motionAnimation.start();

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
      motionAnimation.stop();
      motionTargetsRef.current.clear();
      clearSkillEffects(layer);
      stage.destroy();
    };
  }, []);

  useEffect(() => {
    function onState(room) {
      const receivedAt = Date.now();
      if (Number.isFinite(room.serverNow)) {
        serverClockOffsetRef.current = room.serverNow - receivedAt;
      }
      const serverNow = receivedAt + serverClockOffsetRef.current;
      if (Number.isFinite(room.endsAt)) {
        setRemainingMs(Math.ceil(Math.max(0, room.endsAt - serverNow) / 1000) * 1000);
      }
      setRoundStatus(room.status);
      // 시작 카운트다운(5,4,3,2,1) — 0 이하가 되면 오버레이를 내린다. Math.ceil이라
      // 4001ms 남은 순간에도 "5"가 보인다(사람이 세는 방식과 같음).
      setCountdownSec(
        room.status === 'countdown' && Number.isFinite(room.countdownEndsAt)
          ? Math.max(0, Math.ceil((room.countdownEndsAt - serverNow) / 1000))
          : null,
      );
      const me = room.players[socket.id];
      setRespawnSec(
        me && me.alive === false && Number.isFinite(me.respawnAt)
          ? Math.max(0, Math.ceil((me.respawnAt - serverNow) / 1000))
          : null,
      );
      if (me) {
        setSkillChoices((previous) => {
          const next = me.skillChoices ?? [];
          return sameArray(previous, next) ? previous : next;
        });
        // 개발자 테스트 방은 한 번에 하나를 바꿔 시험하는 기존 skillId 형식도 계속 받는다.
        setMySkillIds((previous) => {
          const next = me.skillIds ?? (me.skillId ? [me.skillId] : []);
          return sameArray(previous, next) ? previous : next;
        });
        setSkillsConfirmed(me.skillSelectionConfirmed === true);
        setSkillReadyAts((previous) => {
          const next = me.skillReadyAts ?? (me.skillId ? { [me.skillId]: me.skillReadyAt ?? 0 } : {});
          return sameNumberRecord(previous, next) ? previous : next;
        });
      }
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

          // 공격 미리보기(텔레그래프) — 내 캐릭터 것만 보여준다(브롤스타즈처럼 상대 조준은
          // 화면에 안 보임). 무기 종류(근접/원거리)는 대전 중 안 바뀌므로 노드 타입은 한 번만
          // 정하고, 이후엔 위치/방향만 갱신한다. meleeHitboxRect는 서버(battleSimulation.js)와
          // 똑같은 계산식을 shapes/attackGeometry.js에서 그대로 가져다 쓴 것이라, 여기 보이는
          // 자리가 실제 판정 자리와 항상 일치한다.
          const previewAimX = p.aimX ?? 0;
          const previewAimY = p.aimY ?? 1;
          if (!previewNodeRef.current) {
            previewNodeRef.current = p.isRanged
              ? new Konva.Line({ points: [0, 0, 0, 0], stroke: 'rgba(255,255,255,0.5)', strokeWidth: 3 })
              : new Konva.Rect({
                  width: ATTACK_HITBOX_SIZE,
                  height: ATTACK_HITBOX_SIZE,
                  // 회전축을 중심에 맞춘다 — 기본값(좌상단 기준 회전)이면 rotation()을 걸었을 때
                  // 실제 판정 자리(meleeHitboxRect의 centerX/centerY 중심)와 어긋나 보인다.
                  offsetX: ATTACK_HITBOX_SIZE / 2,
                  offsetY: ATTACK_HITBOX_SIZE / 2,
                  fill: 'rgba(255,255,255,0.25)',
                });
            layer.add(previewNodeRef.current);
          }
          if (p.isRanged) {
            const range = p.rangeDistance ?? 0;
            previewNodeRef.current.points([p.x, p.y, p.x + previewAimX * range, p.y + previewAimY * range]);
          } else {
            // meleeHitboxRect가 중심좌표+회전각을 주므로, 미리보기도 캐릭터가 든 무기 방향과
            // 똑같이 회전시킨다 — 서버 판정(battleSimulation.js)이 쓰는 값과 완전히 같은
            // 계산식이라 여기 보이는 자리가 실제 판정 자리와 항상 일치한다.
            const hitbox = meleeHitboxRect(p.x, p.y, previewAimX, previewAimY, CHARACTER_RADIUS);
            previewNodeRef.current.x(hitbox.centerX);
            previewNodeRef.current.y(hitbox.centerY);
            previewNodeRef.current.rotation((hitbox.angle * 180) / Math.PI);
          }
        }
        let entry = nodesRef.current[p.id];
        let isNewEntry = false;
        if (!entry) {
          isNewEntry = true;
          const isSelf = p.id === socket.id;
          const circle = new Konva.Circle({
            x: p.x, y: p.y, radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
            // 본인 캐릭터는 흰 테두리로 구분 — 다섯 명이 같은 화면에 있으면 어느 게 내 것인지
            // 색만으로는 구별하기 어려워서(설계 리뷰에서 지적됨).
            stroke: isSelf ? '#ffffff' : undefined,
            strokeWidth: isSelf ? 3 : 0,
          });
          // 머리 위 체력바. moveOne이 캐릭터를 y=CHARACTER_RADIUS까지 위로 붙게 허용하므로,
          // 바를 그 위에 그대로 두면 위쪽 벽 근처에서 stage 밖(y<0)으로 잘려나간다 — 0으로
          // clamp한다(Opus 리뷰 Important I2와 같은 이유).
          const hpBarBg = new Konva.Rect({
            width: HP_BAR_WIDTH, height: HP_BAR_HEIGHT,
            fill: 'rgba(0,0,0,0.55)', stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1,
            cornerRadius: HP_BAR_HEIGHT / 2,
          });
          const hpBarFill = new Konva.Rect({
            width: HP_BAR_WIDTH, height: HP_BAR_HEIGHT,
            fill: HP_COLOR_FULL, cornerRadius: HP_BAR_HEIGHT / 2,
          });
          // 이름표 — 리더보드와 같은 이름을 캐릭터 위에도 띄워야 누가 누군지 알 수 있다.
          const nameLabel = new Konva.Text({
            width: 120, text: p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`,
            fontSize: 11, fontStyle: 'bold', fill: '#fff', align: 'center',
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.9,
          });
          // 죽어 있는 동안 머리 위에 남은 부활 시간을 띄운다.
          const respawnLabel = new Konva.Text({
            width: 120, text: '', fontSize: 13, fontStyle: 'bold', fill: '#ff8080', align: 'center',
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.9, visible: false,
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
          const rightHand = new Konva.Circle({
            radius: 5,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
            stroke: '#ffffff',
            strokeWidth: 1.5,
          });
          layer.add(circle);
          layer.add(rightHand);
          layer.add(weaponGroup);
          layer.add(hpBarBg);
          layer.add(hpBarFill);
          layer.add(nameLabel);
          layer.add(label);
          layer.add(respawnLabel);
          entry = { circle, rightHand, hpBarBg, hpBarFill, nameLabel, respawnLabel, label, weaponGroup };
          nodesRef.current[p.id] = entry;
        }
        // p.connected가 없는(구버전 상태 등 예상 밖) 프레임이 와도 전원이 흐려지지 않도록
        // 명시적으로 false일 때만 흐리게 — p.score ?? 0과 같은 방어 원칙(Opus 리뷰 Minor M2).
        const isConnected = p.connected !== false;
        const isAlive = p.alive !== false;
        const cloakActive = (p.status?.cloakUntil ?? 0) > serverNow;
        const hiddenByCloak = isPlayerHiddenByCloak(p, socket.id, serverNow);
        const selfCloakOpacity = cloakActive && p.id === socket.id ? 0.42 : 1;
        // 연결이 끊겼거나(조작 불가) 죽어서 부활 대기 중이면 흐리게 — 둘 다 "지금은 상호작용
        // 대상이 아니다"라는 같은 뜻이라 같은 표현을 쓴다.
        const opacity = (!isConnected ? 0.2 : isAlive ? 1 : 0.28) * selfCloakOpacity;

        const localHitFlash = p.id === socket.id && hitFlashUntilRef.current > receivedAt;
        moveNodeSmoothly(entry.circle, p.x, p.y, isNewEntry);
        entry.circle.visible(!hiddenByCloak);
        entry.circle.fill(localHitFlash ? '#ff4d4d' : CHARACTER_COLORS[p.characterId] ?? '#999');
        entry.circle.shadowColor(localHitFlash ? '#ff1f1f' : 'transparent');
        entry.circle.shadowBlur(localHitFlash ? 18 : 0);
        entry.circle.opacity(opacity);
        moveNodeSmoothly(entry.label, p.x - CHARACTER_RADIUS, p.y - 7, isNewEntry);
        entry.label.visible(!hiddenByCloak);
        entry.label.opacity(opacity);

        // 체력바 — 남은 비율만큼 채우고, 색으로도 위험도를 알린다(초록 → 노랑 → 빨강).
        const hpRatio = Math.max(0, Math.min(1, (p.hp ?? HP_MAX_CLIENT) / HP_MAX_CLIENT));
        const barX = p.x - HP_BAR_WIDTH / 2;
        const barY = Math.max(0, p.y - CHARACTER_RADIUS - 22);
        moveNodeSmoothly(entry.hpBarBg, barX, barY, isNewEntry);
        entry.hpBarBg.visible(isAlive && !hiddenByCloak);
        moveNodeSmoothly(entry.hpBarFill, barX, barY, isNewEntry);
        entry.hpBarFill.width(HP_BAR_WIDTH * hpRatio);
        entry.hpBarFill.fill(hpRatio > 0.5 ? HP_COLOR_FULL : hpRatio > 0.25 ? HP_COLOR_MID : HP_COLOR_LOW);
        entry.hpBarFill.visible(isAlive && hpRatio > 0 && !hiddenByCloak);
        entry.hpBarBg.opacity(isConnected ? 1 : 0.2);
        entry.hpBarFill.opacity(isConnected ? 1 : 0.2);

        moveNodeSmoothly(entry.nameLabel, p.x - 60, barY - 15, isNewEntry);
        entry.nameLabel.text(p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`);
        entry.nameLabel.visible(!hiddenByCloak);
        entry.nameLabel.opacity(opacity);

        // 부활 카운트 — 죽어 있을 때만.
        const showRespawn = !isAlive && Number.isFinite(p.respawnAt);
        entry.respawnLabel.visible(showRespawn && !hiddenByCloak);
        if (showRespawn) {
          moveNodeSmoothly(entry.respawnLabel, p.x - 60, barY - 2, isNewEntry);
          entry.respawnLabel.text(`부활 ${Math.max(0, Math.ceil((p.respawnAt - serverNow) / 1000))}`);
        }

        // 무기 아이콘 위치/방향 — 조준 벡터(aimX/aimY)를 기준으로 캐릭터 중심에서 연속적으로
        // 오프셋되고, 그 각도만큼 회전한다(예전 4방향 스냅 대신 브롤스타즈처럼 자유 조준).
        // 벽 근처에서 아이콘이 화면 밖으로 잘리지 않게 아레나 범위 안으로 clamp —
        // dragBoundFunc(CanvasEditor.js)/moveOne(battleSimulation.js)과 같은 패턴.
        const aimX = p.aimX ?? 0;
        const aimY = p.aimY ?? 1;
        // 바라보는 방향의 오른쪽 수직 벡터(-aimY, aimX)에 손을 놓고, 살짝 앞으로 내민다.
        const handForward = CHARACTER_RADIUS * 0.45;
        const handSide = CHARACTER_RADIUS * 0.78;
        const handX = Math.min(
          DEFAULT_MAP.arenaSize.width,
          Math.max(0, p.x + aimX * handForward - aimY * handSide),
        );
        const handY = Math.min(
          DEFAULT_MAP.arenaSize.height,
          Math.max(0, p.y + aimY * handForward + aimX * handSide),
        );
        moveNodeSmoothly(entry.rightHand, handX, handY, isNewEntry);
        entry.rightHand.visible(!hiddenByCloak);
        entry.rightHand.opacity(opacity);
        moveNodeSmoothly(entry.weaponGroup, handX, handY, isNewEntry);
        entry.weaponGroup.rotation((Math.atan2(aimY, aimX) * 180) / Math.PI);
        entry.weaponGroup.visible(!hiddenByCloak);
        entry.weaponGroup.opacity(opacity);
      });

      // 투사체 렌더링 — 플레이어 노드와 달리 계속 생겼다 없어지므로, 이번 프레임에 없는
      // id의 노드는 지운다(플레이어 노드는 한 번 생기면 안 사라지는 지금 방식과 다름).
      const liveProjectileIds = new Set((room.projectiles ?? []).map((proj) => proj.id));
      Object.keys(projectileNodesRef.current).forEach((id) => {
        if (!liveProjectileIds.has(id)) {
          projectileNodesRef.current[id].destroy();
          delete projectileNodesRef.current[id];
        }
      });
      (room.projectiles ?? []).forEach((proj) => {
        let node = projectileNodesRef.current[proj.id];
        let isNewProjectile = false;
        if (!node) {
          isNewProjectile = true;
          node = new Konva.Circle({ radius: PROJECTILE_RADIUS, fill: '#f1c40f' });
          layer.add(node);
          projectileNodesRef.current[proj.id] = node;
        }
        moveNodeSmoothly(node, proj.x, proj.y, isNewProjectile);
      });

      // 특수 스킬 이펙트(지뢰/블랙홀/진주/오라/부채꼴 등) — 서버가 보낸 것을 그대로 그린다.
      // 지뢰 본체는 설치자에게만 보이도록 내 소켓 id를 같이 넘긴다.
      drawSkillEffects(Konva, layer, {
        ...room,
        selfId: socket.id,
        camera: cameraRef.current,
        viewport: VIEWPORT_SIZE,
      }, serverNow);

      // 위치와 속성 변경은 위 Konva.Animation이 브라우저 주사율로 그린다. 여기서 매
      // 네트워크 패킷마다 별도로 draw하면 같은 프레임을 중복 렌더링하게 된다.
    }
    socket.on('battle:state', onState);
    return () => socket.off('battle:state', onState);
  }, [socket]);

  useEffect(() => {
    function onBattleEvents(events) {
      if (!hasLocalDamage(events, socket.id)) return;
      hitFlashUntilRef.current = Date.now() + 280;
      setHitFlashPulse((pulse) => pulse + 1);
      clearTimeout(hitFlashTimerRef.current);
      hitFlashTimerRef.current = setTimeout(() => setHitFlashPulse(0), 280);

      // 다음 20Hz 상태 프레임을 기다리지 않고 피격 즉시 캐릭터를 빨갛게 번쩍인다.
      const selfNode = nodesRef.current[socket.id]?.circle;
      if (selfNode) {
        selfNode.fill('#ff4d4d');
        selfNode.shadowColor('#ff1f1f');
        selfNode.shadowBlur(18);
        layerRef.current?.draw();
      }
    }
    socket.on('battle:events', onBattleEvents);
    return () => {
      socket.off('battle:events', onBattleEvents);
      clearTimeout(hitFlashTimerRef.current);
    };
  }, [socket]);

  useEffect(() => {
    // 탈락이 없는 점수제라 승/패보다 등수가 더 정확한 표현이다(공동 순위도 있을 수 있음) —
    // win은 result-page 등 기존 소비처와의 호환을 위해 그대로 같이 들고 있는다.
    // result:saved(QR용 id)는 여기서 안 듣는다 — Supabase 저장은 비동기라 stage가 이미
    // result로 넘어가 이 화면이 unmount된 뒤에 도착하는 경우가 흔해서, 화면 전환과 무관하게
    // 항상 떠 있는 app.js에서 듣는다(frontend/src/app.js 참고).
    function onResult({ win, score, rank, total, kills, deaths, assists }) {
      state.battleResult = { win, score, rank, total, kills, deaths, assists };
    }
    socket.on('battle:result', onResult);
    return () => socket.off('battle:result', onResult);
  }, [socket, state]);

  useEffect(() => {
    // 판이 끝나면 최종 순위 대시보드, 새 판이 시작되면 null이 와서 자동으로 내려간다.
    socket.on('battle:standings', setStandings);
    // 이 화면은 stage가 battle이 될 때 비로소 마운트되므로, 그 전에 서버가 한 번 보낸
    // 대시보드/상태를 놓칠 수 있다(대시보드 도중 새로고침한 경우도 마찬가지) — 마운트
    // 시점에 현재 상태를 한 번 더 달라고 요청한다.
    socket.emit('battle:requestSync');
    return () => socket.off('battle:standings', setStandings);
  }, [socket]);

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
      // 특수 스킬 4칸 — Z/X/C/V가 선택 순서 0/1/2/3에 대응한다.
      const skillIndex = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'].indexOf(e.code);
      if (skillIndex >= 0) {
        e.preventDefault();
        const skillId = mySkillIds[skillIndex];
        if (!e.repeat && skillId) socket.emit('battle:skill', skillId);
        return;
      }
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
    // onKeyDown이 socket.emit('battle:skill')을 쓰므로 socket이 의존성에 들어가야 한다.
  }, [socket, mySkillIds]);

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
    moveNodeSmoothly(layer, -cameraX, -cameraY);
  }

  // PC 조준 — 아레나 위 마지막 마우스 위치와 내 캐릭터 위치(selfPosRef)의 차이를 방향벡터로
  // 보낸다. mousemove(마우스가 움직였을 때)뿐 아니라 battle:state 갱신(내 캐릭터가 움직였을
  // 때)에서도 호출된다 — 마우스가 가만히 있어도 캐릭터가 이동 중이면 조준 방향이 계속
  // 새로 계산돼야 하기 때문(Opus 리뷰 Important I2). mousedown(누르는 순간)은 그 시점의
  // 조준 방향으로 공격을 1회 발사한다 — 누르고 있어도 추가로 발사되지 않는다(쿨다운마다
  // 다시 클릭해야 함).
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

  // Konva Stage가 붙은 .battle-arena는 BattleScreen이 살아 있는 동안 절대 DOM에서 빼지
  // 않는다. 예전에는 룰렛/순위표에서 early return으로 캔버스를 제거했다가 카운트다운 때
  // 새 div를 만들었기 때문에, Konva는 이미 제거된 옛 div를 계속 바라보고 새 화면에는 맵이
  // 안 나타났다. 준비 화면과 순위표는 영구 캔버스 위 DOM 오버레이로만 교체한다.
  const controlsEnabled = roundStatus === 'active' && !standings;
  return html`
    <div class="battle-shell" style=${{ '--arena-width': `${VIEWPORT_SIZE.width}px` }}>
      <div class="battle-viewport">
        <div class="battle-arena" ref=${containerRef}></div>
        ${hitFlashPulse > 0
          ? html`<div class="battle-hit-flash" key=${hitFlashPulse} aria-hidden="true"></div>`
          : null}
        ${roundStatus === 'active' && remainingMs !== null
          ? html`<div class="battle-timer">${formatTimeRemaining(remainingMs)}</div>`
          : null}

        ${countdownSec !== null && countdownSec > 0
          ? html`
              <div class="battle-overlay battle-overlay--countdown">
                <p class="countdown-label">잠시 후 시작합니다</p>
                <p class="countdown-number" key=${countdownSec}>${countdownSec}</p>
              </div>
            `
          : null}

        ${respawnSec !== null
          ? html`
              <div class="battle-overlay battle-overlay--dead">
                <p class="dead-label">쓰러졌습니다</p>
                <p class="dead-timer">${respawnSec}초 후 부활</p>
              </div>
            `
          : null}

        ${roundStatus === 'roulette' && skillChoices.length > 0 && !standings
          ? html`
              <div class="battle-phase-overlay battle-phase-overlay--roulette">
                <${SkillRoulette}
                  choices=${skillChoices}
                  picked=${mySkillIds}
                  confirmed=${skillsConfirmed}
                  onPick=${(id) => {
                    setSkillsConfirmed(false);
                    setMySkillIds((selected) => selected.includes(id)
                      ? selected.filter((skillId) => skillId !== id)
                      : selected.length < 4 ? [...selected, id] : selected);
                    socket.emit('battle:pickSkill', id);
                  }}
                  onConfirm=${() => socket.emit('battle:confirmSkills')}
                />
              </div>
            `
          : null}

        ${standings
          ? html`
              <div class="battle-phase-overlay battle-phase-overlay--standings">
                <${StandingsBoard} standings=${standings} selfId=${socket.id} />
              </div>
            `
          : null}
      </div>
      <div class="battle-controls ${controlsEnabled ? '' : 'is-hidden'}" aria-hidden=${!controlsEnabled}>
        <${VirtualJoystick} onChange=${onMoveStick} />
        <div class="battle-skill-slot">
          ${mySkillIds.map((skillId, index) => html`
            <${SkillButton}
              key=${skillId}
              skillId=${skillId}
              keyLabel=${['Z', 'X', 'C', 'V'][index]}
              readyAt=${skillReadyAts[skillId] ?? 0}
              onUse=${() => socket.emit('battle:skill', skillId)}
            />
          `)}
        </div>
        <${VirtualJoystick} onChange=${onAimStick} onRelease=${onAimRelease} className="aim" />
      </div>
    </div>
  `;
}

// 한 판이 끝난 뒤의 최종 순위표 — 1등부터 꼴등까지 킬/데스/어시스트/종합 점수.
// 참가자 화면과 공용화면(admin/display)이 같은 데이터를 보므로 컴포넌트를 export한다.
export function StandingsBoard({ standings, selfId }) {
  const rows = standings?.standings ?? [];
  return html`
    <div class="card standings-card">
      <p class="eyebrow">${standings?.round ? `${standings.round}판 결과` : '결과'}</p>
      <h2 class="title">최종 순위</h2>
      <p class="subtitle standings-formula">킬 +20 · 데스 −10 · 어시스트 +5</p>

      <div class="standings-scroll">
        <table class="standings-table">
          <thead>
            <tr>
              <th class="col-rank">순위</th>
              <th class="col-name">이름</th>
              <th>킬</th>
              <th>데스</th>
              <th>어시</th>
              <th class="col-score">종합</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (p) => html`
                <tr class=${`${p.id === selfId ? 'is-self' : ''} ${p.rank === 1 ? 'is-top' : ''}`}>
                  <td class="col-rank">${p.rank}</td>
                  <td class="col-name">
                    ${p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`}
                    ${p.id === selfId ? html`<span class="self-tag">나</span>` : null}
                  </td>
                  <td>${p.kills}</td>
                  <td>${p.deaths}</td>
                  <td>${p.assists}</td>
                  <td class="col-score">${p.score}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>

      <p class="standings-wait">
        진행자를 기다리는 중<span class="dots"><i></i><i></i><i></i></span>
      </p>
    </div>
  `;
}
