// 특수 스킬의 시각 효과를 Konva로 그린다.
//
// 서버가 room.effects / room.mines / room.blackholes / room.pearls에 "무엇이 어디에 언제까지
// 있는지"만 담아 보내고, 여기서는 그걸 그대로 그린다 — 파티클을 클라이언트가 스스로 만들면
// 참가자마다 다른 화면을 보게 되고 "모두에게 보인다"는 요구를 못 지킨다.
//
// 매 프레임 노드를 새로 만들지 않고 id별로 재사용한다 — 서버 틱이 20Hz라 노드를 매번
// 지웠다 만들면 이펙트가 깜빡인다.
// BattleScreen마다 독립된 Konva Layer를 사용한다. 화면을 전환하거나 개발자 화면에서
// 조종 대상을 바꿀 때 다른 캔버스의 같은 effect id가 재사용되면 파티클이 새 화면에
// 붙지 않는다. 따라서 노드 캐시도 Layer별로 완전히 분리한다.
const nodeStores = new Map();

function nodeStoreFor(layer) {
  let store = nodeStores.get(layer);
  if (!store) {
    store = new Map();
    nodeStores.set(layer, store);
  }
  return store;
}

function syncGroup(layer, liveIds) {
  const nodes = nodeStoreFor(layer);
  for (const [id, node] of nodes) {
    if (!liveIds.has(id)) {
      node.destroy();
      nodes.delete(id);
    }
  }
}

// 서버 틱/네트워크가 잠시 멈춰 마지막 room 스냅샷이 남아 있어도, 종료 시각을 지난
// 파티클을 클라이언트가 계속 그리지 않게 한다. endsAt이 없는 구형 데이터만 활성으로 본다.
export function isTimedVisualActive(visual, now) {
  return !Number.isFinite(visual?.endsAt) || visual.endsAt > now;
}

// 진행도(0~1) — 이펙트가 끝나갈수록 흐려지거나 커지는 데 쓴다.
function progress(effect, now, fallbackMs = 600) {
  const total = effect.durationMs ?? fallbackMs;
  const remain = Math.max(0, effect.endsAt - now);
  return 1 - Math.min(1, remain / total);
}

function playerPos(room, playerId) {
  const p = room.players[playerId];
  return p ? { x: p.x, y: p.y } : null;
}

export function isMineVisibleToViewer(mine, selfId) {
  return mine?.ownerId === selfId;
}

export function isEffectVisibleToViewer(effect, selfId, players = null, now = 0) {
  // 스킬 파티클 중 유일한 본인 전용 예외은 투명망토 상태 안내다.
  if (effect?.type === 'cloakSelf') return effect.ownerId === selfId;
  // 투명 상태인 상대를 따라다니는 오라/표식까지 보이면 캐릭터 본체를 숨겨도 위치가 그대로
  // 노출된다. playerId가 있는 부착형 효과만 숨기고, 이미 바닥에 펼쳐진 범위 효과는 유지한다.
  if (effect?.playerId && isPlayerHiddenByCloak(players?.[effect.playerId], selfId, now)) return false;
  return true;
}

export function isPlayerHiddenByCloak(player, selfId, now) {
  return player?.id !== selfId && (player?.status?.cloakUntil ?? 0) > now;
}

// 사형선고 대상이 현재 카메라 밖에 있으면, 대상 방향의 화면 가장자리로 표식을 옮긴다.
// 반환 좌표는 카메라가 적용된 월드 좌표라 기존 Konva 레이어에 그대로 그릴 수 있다.
export function markDisplayPosition(target, camera, viewport, margin = 58) {
  if (!target || !camera || !viewport) return { ...(target ?? { x: 0, y: 0 }), offscreen: false, angle: 0 };
  const sx = target.x - camera.x;
  const sy = target.y - camera.y;
  const inside = sx >= margin && sx <= viewport.width - margin && sy >= margin && sy <= viewport.height - margin;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const dx = sx - centerX;
  const dy = sy - centerY;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (inside) return { x: target.x, y: target.y, offscreen: false, angle };

  const halfW = Math.max(1, centerX - margin);
  const halfH = Math.max(1, centerY - margin);
  const scaleX = Math.abs(dx) > 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return {
    x: camera.x + centerX + dx * scale,
    y: camera.y + centerY + dy * scale,
    offscreen: true,
    angle,
  };
}

export function drawSkillEffects(Konva, layer, room, now) {
  const nodes = nodeStoreFor(layer);
  const live = new Set();

  // ── 설치물: 지뢰(설치자에게만 희미하게 보임) ────────────────────────
  for (const mine of room.mines ?? []) {
    if (!isTimedVisualActive(mine, now)) continue;
    const id = `mine-${mine.id}`;
    live.add(id);
    let node = nodes.get(id);
    if (!node) {
      node = new Konva.Circle({ radius: 14, stroke: '#ff6b6b', strokeWidth: 2, dash: [4, 4], opacity: 0.5 });
      layer.add(node);
      nodes.set(id, node);
    }
    node.x(mine.x);
    node.y(mine.y);
    // 설치된 지뢰 본체만 상대에게 숨긴다. 폭발(mineBoom) 파티클은 공용 effects에서 모두에게 보인다.
    node.visible(isMineVisibleToViewer(mine, room.selfId));
    node.moveToTop();
  }

  // ── 블랙홀: 검정+보라 소용돌이 ──────────────────────────────────────
  for (const bh of room.blackholes ?? []) {
    if (!isTimedVisualActive(bh, now)) continue;
    const id = `bh-${bh.id}`;
    live.add(id);
    let node = nodes.get(id);
    if (!node) {
      node = new Konva.Group();
      node.add(new Konva.Circle({ radius: bh.radius, fill: 'rgba(120,80,200,0.13)', stroke: '#a98bff', strokeWidth: 2 }));
      node.add(new Konva.Circle({ radius: 26, fill: '#0a0612', stroke: '#a98bff', strokeWidth: 3 }));
      node.add(new Konva.Arc({ innerRadius: 34, outerRadius: 46, angle: 220, fill: 'rgba(169,139,255,0.45)' }));
      layer.add(node);
      nodes.set(id, node);
    }
    node.x(bh.x);
    node.y(bh.y);
    node.moveToTop();
    // 소용돌이 — 시간에 비례해 회전시킨다.
    node.getChildren()[2].rotation((now / 3) % 360);
  }

  // ── 순간이동 진주 ───────────────────────────────────────────────────
  for (const pearl of room.pearls ?? []) {
    if (!isTimedVisualActive(pearl, now)) continue;
    const id = `pearl-${pearl.id}`;
    live.add(id);
    let node = nodes.get(id);
    if (!node) {
      node = new Konva.Circle({ radius: 7, fill: '#ffffff', shadowColor: '#ffffff', shadowBlur: 14 });
      layer.add(node);
      nodes.set(id, node);
    }
    node.x(pearl.x);
    node.y(pearl.y);
    node.moveToTop();
  }

  // ── 일회성/지속 이펙트 ──────────────────────────────────────────────
  for (const fx of room.effects ?? []) {
    if (!isTimedVisualActive(fx, now)) continue;
    const id = `fx-${fx.id}`;
    live.add(id);
    let node = nodes.get(id);
    const t = progress(fx, now);

    // 플레이어를 따라다니는 이펙트는 매 프레임 위치를 갱신한다.
    const follow = fx.playerId ? playerPos(room, fx.playerId) : null;
    const markPosition = fx.type === 'mark' && follow
      ? markDisplayPosition(follow, room.camera, room.viewport)
      : null;
    const x = markPosition ? markPosition.x : follow ? follow.x : fx.x;
    const y = markPosition ? markPosition.y : follow ? follow.y : fx.y;

    if (!node) {
      node = buildEffectNode(Konva, fx);
      if (!node) continue;
      layer.add(node);
      nodes.set(id, node);
    }
    node.x(x ?? 0);
    node.y(y ?? 0);
    if (fx.type === 'mark') {
      const arrow = node.getChildren()[1];
      arrow.visible(Boolean(markPosition?.offscreen));
      const radians = (markPosition?.angle ?? 0) * Math.PI / 180;
      arrow.x(Math.cos(radians) * 25);
      arrow.y(Math.sin(radians) * 25);
      arrow.rotation((markPosition?.angle ?? 0) + 90);
    }
    // 투명망토 발동 안내는 사용자 본인에게만 보여 은신 위치를 노출하지 않는다.
    node.visible(isEffectVisibleToViewer(fx, room.selfId, room.players, now));
    // 이후에 생성된 투사체/플레이어 노드 뒤로 파티클이 묻히지 않게 한다.
    node.moveToTop();
    animateEffect(node, fx, t, now);
  }

  syncGroup(layer, live);
}

function buildEffectNode(Konva, fx) {
  const color = fx.color ?? '#ffffff';
  switch (fx.type) {
    // 자기 몸에 붙는 오라류 — 색만 다르고 모양은 같은 링이라 한 벌로 처리한다.
    case 'heal':
      return ringWithMark(Konva, color, '✚');
    case 'shield':
      return ringWithMark(Konva, color, '🛡');
    case 'reflectAura': {
      // 캐릭터 외곽선과 겹쳐도 즉시 알아볼 수 있도록 이중 육각 방벽과 중심 광원을 함께 쓴다.
      const aura = new Konva.Group();
      aura.add(new Konva.RegularPolygon({
        sides: 6, radius: 34, stroke: '#ffffff', strokeWidth: 2,
        fill: 'rgba(192, 139, 255, 0.16)', shadowColor: color, shadowBlur: 18,
      }));
      aura.add(new Konva.RegularPolygon({
        sides: 6, radius: 43, stroke: color, strokeWidth: 4, dash: [9, 5], opacity: 0.95,
      }));
      aura.add(new Konva.Circle({ radius: 7, fill: color, opacity: 0.8 }));
      return aura;
    }
    case 'reflect':
      return new Konva.RegularPolygon({ sides: 6, radius: 18, fill: color, opacity: 0.7 });
    case 'speedUp':
      return ringWithMark(Konva, color, '▲');
    case 'cloakSelf': {
      const cloak = new Konva.Group();
      cloak.add(new Konva.Circle({
        radius: 33, stroke: '#d5dbe6', strokeWidth: 3, dash: [7, 5],
        fill: 'rgba(213, 219, 230, 0.08)', shadowColor: '#d5dbe6', shadowBlur: 14,
        // fill+stroke+shadowBlur가 같이 있으면 Konva가 정확한 합성을 위해 오프스크린
        // 버퍼에 두 번 그린다(perfectDrawEnabled 기본값 true) — 게다가 이 노드는
        // animateEffect의 default 분기로 10초 내내 매 프레임 opacity가 계속 바뀐다(자기 상태
        // 효과 중 가장 긴 지속시간). 구형 기기에서 프레임이 끊긴다는 제보가 있어 이 조합만
        // 근사 렌더로 낮춘다 — 얇은 점선 링이라 시각적 차이는 거의 없다.
        perfectDrawEnabled: false,
      }));
      cloak.add(new Konva.Text({ text: '👻', fontSize: 18, offsetX: 9, offsetY: 48, opacity: 0.9 }));
      return cloak;
    }
    case 'lastStand':
      return ringWithMark(Konva, color, '⚡');
    case 'poisonArm':
      return ringWithMark(Konva, color, '☠');
    case 'poisoned':
      return new Konva.Circle({ radius: 24, fill: 'rgba(125,220,106,0.25)', stroke: color, strokeWidth: 2 });
    case 'frozenIce': {
      const ice = new Konva.Group();
      ice.add(new Konva.Rect({
        x: -27, y: -31, width: 54, height: 62,
        fill: 'rgba(143, 211, 255, 0.34)', stroke: '#bfeaff', strokeWidth: 3,
        cornerRadius: 7, shadowColor: '#8fd3ff', shadowBlur: 12, shadowOpacity: 0.8,
      }));
      ice.add(new Konva.Line({
        points: [-18, -20, -7, -8, -14, 4, 1, 18, 11, 7, 20, 18],
        stroke: 'rgba(235, 250, 255, 0.9)', strokeWidth: 2, lineCap: 'round', lineJoin: 'round',
      }));
      return ice;
    }
    case 'mark': {
      const mark = new Konva.Group();
      mark.add(new Konva.Text({
        text: '🎯', fontSize: 28, offsetX: 14, offsetY: 52,
        shadowColor: '#000000', shadowBlur: 5, shadowOpacity: 0.9,
      }));
      mark.add(new Konva.RegularPolygon({
        sides: 3, radius: 8, fill: color, stroke: '#ffffff', strokeWidth: 1.5,
        shadowColor: '#000000', shadowBlur: 4, shadowOpacity: 0.85,
      }));
      return mark;
    }

    // 범위 효과 — 시전자 기준 원.
    case 'shockwave':
    case 'slowHell':
    case 'timeStop':
      return new Konva.Circle({
        radius: fx.radius ?? 100,
        stroke: color,
        strokeWidth: 4,
        fill: fx.type === 'timeStop' ? 'rgba(213,219,230,0.12)' : 'rgba(143,211,255,0.1)',
      });

    // 부채꼴(연행영장/콜드플레이/사형선고)
    case 'cone': {
      const angleDeg = ((fx.halfAngle ?? 0.6) * 2 * 180) / Math.PI;
      const wedge = new Konva.Wedge({
        radius: fx.range ?? 200,
        angle: angleDeg,
        fill: color,
        opacity: 0.22,
        rotation: (Math.atan2(fx.aimY ?? 1, fx.aimX ?? 0) * 180) / Math.PI - angleDeg / 2,
      });
      return wedge;
    }

    // 선/이동 궤적
    case 'dash':
    case 'blinkJump':
    case 'recallJump':
    case 'pullLine':
      return new Konva.Line({
        points: [(fx.fromX ?? 0) - (fx.x ?? 0), (fx.fromY ?? 0) - (fx.y ?? 0), 0, 0],
        stroke: color,
        strokeWidth: 5,
        opacity: 0.8,
        lineCap: 'round',
      });

    case 'recallMark':
      return new Konva.Circle({ radius: 22, stroke: color, strokeWidth: 3, dash: [6, 5], opacity: 0.9 });

    case 'mineBoom':
      return new Konva.Circle({ radius: 10, fill: 'rgba(255,107,107,0.55)', stroke: '#ff6b6b', strokeWidth: 3 });

    default:
      return null;
  }
}

// 링 + 가운데 기호 — 힐/실드/속도증가처럼 "내 몸에 붙는" 이펙트의 공통 모양.
function ringWithMark(Konva, color, mark) {
  const group = new Konva.Group();
  group.add(new Konva.Circle({ radius: 30, stroke: color, strokeWidth: 3, opacity: 0.9 }));
  group.add(new Konva.Text({ text: mark, fontSize: 18, offsetX: 9, offsetY: 42 }));
  return group;
}

function animateEffect(node, fx, t, now) {
  switch (fx.type) {
    case 'shockwave':
    case 'mineBoom':
      // 퍼져나가면서 옅어진다.
      node.scale({ x: 1 + t * 2.2, y: 1 + t * 2.2 });
      node.opacity(1 - t);
      break;
    case 'dash':
    case 'blinkJump':
    case 'recallJump':
    case 'pullLine':
    case 'cone':
    case 'reflect':
      node.opacity(Math.max(0, 0.85 * (1 - t)));
      break;
    case 'timeStop':
      // 시계 바늘이 도는 느낌으로 천천히 회전.
      node.rotation((now / 12) % 360);
      node.opacity(0.9 - t * 0.5);
      break;
    case 'reflectAura': {
      const pulse = 1 + 0.09 * Math.sin(now / 110);
      node.scale({ x: pulse, y: pulse });
      node.rotation((now / 18) % 360);
      node.opacity(0.88 + 0.12 * Math.abs(Math.sin(now / 140)));
      break;
    }
    case 'heal':
    case 'speedUp':
      node.opacity(1 - t);
      node.y(node.y() - t * 6);
      break;
    default:
      // 지속형 오라(실드/독 등)는 은은하게 맥동시킨다.
      node.opacity(0.55 + 0.35 * Math.abs(Math.sin(now / 220)));
      break;
  }
}

// 화면을 나가거나 새 판이 시작될 때 남은 노드를 정리한다.
export function clearSkillEffects(layer) {
  if (layer) {
    const nodes = nodeStores.get(layer);
    if (!nodes) return;
    for (const node of nodes.values()) node.destroy();
    nodes.clear();
    nodeStores.delete(layer);
    return;
  }
  for (const nodes of nodeStores.values()) {
    for (const node of nodes.values()) node.destroy();
    nodes.clear();
  }
  nodeStores.clear();
}
