// 특수 스킬의 시각 효과를 Konva로 그린다.
//
// 서버가 room.effects / room.mines / room.blackholes / room.pearls에 "무엇이 어디에 언제까지
// 있는지"만 담아 보내고, 여기서는 그걸 그대로 그린다 — 파티클을 클라이언트가 스스로 만들면
// 참가자마다 다른 화면을 보게 되고 "모두에게 보인다"는 요구를 못 지킨다.
//
// 매 프레임 노드를 새로 만들지 않고 id별로 재사용한다 — 서버 틱이 20Hz라 노드를 매번
// 지웠다 만들면 이펙트가 깜빡인다.
const nodes = new Map();

function syncGroup(layer, Konva, liveIds) {
  for (const [id, node] of nodes) {
    if (!liveIds.has(id)) {
      node.destroy();
      nodes.delete(id);
    }
  }
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

export function drawSkillEffects(Konva, layer, room, now) {
  const live = new Set();

  // ── 설치물: 지뢰(설치자에게만 희미하게 보임) ────────────────────────
  for (const mine of room.mines ?? []) {
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
    // 설치한 본인만 위치를 확인할 수 있다(요구사항) — 남에게는 아예 안 보인다.
    node.visible(mine.ownerId === room.selfId);
  }

  // ── 블랙홀: 검정+보라 소용돌이 ──────────────────────────────────────
  for (const bh of room.blackholes ?? []) {
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
    // 소용돌이 — 시간에 비례해 회전시킨다.
    node.getChildren()[2].rotation((now / 3) % 360);
  }

  // ── 순간이동 진주 ───────────────────────────────────────────────────
  for (const pearl of room.pearls ?? []) {
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
  }

  // ── 일회성/지속 이펙트 ──────────────────────────────────────────────
  for (const fx of room.effects ?? []) {
    const id = `fx-${fx.id}`;
    live.add(id);
    let node = nodes.get(id);
    const t = progress(fx, now);

    // 플레이어를 따라다니는 이펙트는 매 프레임 위치를 갱신한다.
    const follow = fx.playerId ? playerPos(room, fx.playerId) : null;
    const x = follow ? follow.x : fx.x;
    const y = follow ? follow.y : fx.y;

    if (!node) {
      node = buildEffectNode(Konva, fx);
      if (!node) continue;
      layer.add(node);
      nodes.set(id, node);
    }
    node.x(x ?? 0);
    node.y(y ?? 0);
    animateEffect(node, fx, t, now);
  }

  syncGroup(layer, Konva, live);
}

function buildEffectNode(Konva, fx) {
  const color = fx.color ?? '#ffffff';
  switch (fx.type) {
    // 자기 몸에 붙는 오라류 — 색만 다르고 모양은 같은 링이라 한 벌로 처리한다.
    case 'heal':
      return ringWithMark(Konva, color, '✚');
    case 'shield':
      return ringWithMark(Konva, color, '🛡');
    case 'reflectAura':
      return new Konva.RegularPolygon({ sides: 6, radius: 30, stroke: color, strokeWidth: 3, opacity: 0.85 });
    case 'reflect':
      return new Konva.RegularPolygon({ sides: 6, radius: 18, fill: color, opacity: 0.7 });
    case 'speedUp':
      return ringWithMark(Konva, color, '▲');
    case 'berserk':
      return new Konva.Circle({ radius: 28, stroke: color, strokeWidth: 4, opacity: 0.8, shadowColor: color, shadowBlur: 20 });
    case 'lastStand':
      return ringWithMark(Konva, color, '⚡');
    case 'poisonArm':
      return ringWithMark(Konva, color, '☠');
    case 'poisoned':
      return new Konva.Circle({ radius: 24, fill: 'rgba(125,220,106,0.25)', stroke: color, strokeWidth: 2 });
    case 'mark':
      return new Konva.Text({
        text: '🎯', fontSize: 22, offsetX: 11, offsetY: 46,
      });

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
    case 'heal':
    case 'speedUp':
      node.opacity(1 - t);
      node.y(node.y() - t * 6);
      break;
    default:
      // 지속형 오라(실드/광전사/독 등)는 은은하게 맥동시킨다.
      node.opacity(0.55 + 0.35 * Math.abs(Math.sin(now / 220)));
      break;
  }
}

// 화면을 나가거나 새 판이 시작될 때 남은 노드를 정리한다.
export function clearSkillEffects() {
  for (const node of nodes.values()) node.destroy();
  nodes.clear();
}
