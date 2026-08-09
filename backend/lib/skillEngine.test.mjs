import assert from 'node:assert';
import {
  activateSkill,
  tickSkillWorld,
  newPlayerSkillState,
  resetSkillsOnRespawn,
  speedMultiplier,
  isInvulnerable,
  isFrozen,
  outgoingDamageMultiplier,
  incomingDamageMultiplier,
  ensureSkillWorld,
} from './skillEngine.js';
import { stepSimulation, HP_MAX } from './battleSimulation.js';
import { SKILLS, getSkill, drawSkillChoices, METER } from '../../shapes/skills.js';

const NOW = 1_000_000;

function makePlayer(id, skillId, overrides = {}) {
  return {
    id, characterId: 'char1', name: id,
    x: 500, y: 500, aimX: 1, aimY: 0,
    hp: HP_MAX, alive: true, respawnAt: 0,
    kills: 0, deaths: 0, assists: 0, recentDamagers: {},
    hpDamage: 10, connected: true, lastAttackAt: 0, attackRequested: false,
    isRanged: false, rangeDistance: null,
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    skillChoices: [],
    ...newPlayerSkillState(skillId),
    ...overrides,
  };
}

function makeRoom(players, overrides = {}) {
  return ensureSkillWorld({
    status: 'active', endsAt: NOW + 100000, moveSpeed: 8,
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    walls: [], arenaSize: { width: 2000, height: 2000 },
    spawnPoints: [{ x: 100, y: 100 }], projectiles: [],
    ...overrides,
  });
}

// ── 스킬 목록 자체의 무결성 ─────────────────────────────────────────────
{
  const ids = SKILLS.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, '스킬 id가 중복되면 안 됨');
  for (const s of SKILLS) {
    assert.ok(s.name && s.desc && s.icon, `${s.id}에 이름/설명/아이콘이 있어야 함`);
    if (s.id === 'lastStand') {
      assert.strictEqual(s.activationDurationMs, 0, '최후의 발악은 HP 조건 동안 무제한이므로 고정 발동시간 없음');
      assert.strictEqual(s.cooldownMs, 0, '최후의 발악은 대기시간 없음');
    } else {
      assert.ok(Number.isFinite(s.activationDurationMs) && s.activationDurationMs > 0, `${s.id}의 발동시간이 양수여야 함`);
      assert.ok(Number.isFinite(s.cooldownMs) && s.cooldownMs > 0, `${s.id}의 대기시간이 양수여야 함`);
    }
    assert.ok(
      ['self', 'aura', 'cone', 'place', 'shot', 'toggle', 'passive'].includes(s.kind),
      `${s.id}의 kind가 알 수 없는 값: ${s.kind}`,
    );
  }
  console.log(`skill registry is well-formed (${SKILLS.length} skills): OK`);
}

// 룰렛 9칸은 항상 서로 다른 스킬.
{
  for (let i = 0; i < 200; i += 1) {
    const choices = drawSkillChoices(9);
    assert.strictEqual(choices.length, 9);
    assert.strictEqual(new Set(choices).size, 9, `중복 발생: ${choices.join(',')}`);
    assert.ok(choices.every((id) => getSkill(id)), '존재하지 않는 스킬이 뽑히면 안 됨');
  }
  console.log('drawSkillChoices always returns 9 distinct, valid skills: OK');
}

// ── 쿨타임 ──────────────────────────────────────────────────────────────
{
  const p = makePlayer('p1', 'heal', { hp: 40 });
  const room = makeRoom([p, makePlayer('p2', 'heal')]);
  assert.strictEqual(activateSkill(room, 'p1', NOW), true, '처음엔 바로 쓸 수 있어야 함(요구사항)');
  assert.strictEqual(p.hp, 70, '힐은 30% 회복');
  assert.strictEqual(p.skillReadyAt, NOW + getSkill('heal').cooldownMs);

  assert.strictEqual(activateSkill(room, 'p1', NOW + 1000), false, '쿨타임 중에는 발동하지 않음');
  assert.strictEqual(activateSkill(room, 'p1', NOW + getSkill('heal').cooldownMs), true, '쿨타임이 끝나면 다시 발동');
  console.log('skills respect their cooldown and are ready at round start: OK');
}

// 부활하면 쿨타임과 버프/디버프가 모두 초기화된다(요구사항).
{
  const p = makePlayer('p1', 'shield', { skillReadyAt: NOW + 99999 });
  p.status.frozenUntil = NOW + 5000;
  const revived = resetSkillsOnRespawn(p);
  assert.strictEqual(revived.skillReadyAt, 0, '부활하면 스킬을 바로 쓸 수 있어야 함');
  assert.strictEqual(isFrozen(revived, NOW), false, '부활하면 걸려 있던 CC가 풀려야 함');
  console.log('respawn clears cooldowns and status effects: OK');
}

// ── 개별 스킬 ───────────────────────────────────────────────────────────
// 힐은 최대치를 넘기지 않는다.
{
  const p = makePlayer('p1', 'heal', { hp: 90 });
  activateSkill(makeRoom([p]), 'p1', NOW);
  assert.strictEqual(p.hp, HP_MAX, '힐이 최대 체력을 넘기면 안 됨');
}

// 실드/투명망토 — 무적이라 피해가 통째로 무시된다.
for (const skillId of ['shield', 'cloak']) {
  const attacker = makePlayer('a', 'lucky', { x: 500, y: 500, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const target = makePlayer('t', skillId, { x: 545, y: 500 });
  const room = makeRoom([attacker, target]);
  activateSkill(room, 't', NOW);
  assert.strictEqual(isInvulnerable(target, NOW), true, `${skillId}은 무적이어야 함`);
  if (skillId === 'cloak') {
    const cloakFx = room.effects.find((fx) => fx.type === 'cloakSelf');
    assert.ok(cloakFx, '투명망토 사용자에게 발동 파티클이 있어야 함');
    assert.strictEqual(cloakFx.ownerOnly, true, '투명망토 파티클은 상대에게 보이면 안 됨');
    assert.strictEqual(cloakFx.ownerId, 't');
  }
  const { room: next } = stepSimulation(room, NOW);
  assert.strictEqual(next.players.t.hp, HP_MAX, `${skillId} 중에는 피해를 받지 않아야 함`);
}
console.log('shield/cloak fully block incoming damage: OK');

// 속도증가 / 속도지옥 / 시간정지 — 이동 배율.
{
  const p = makePlayer('p1', 'speedUp');
  activateSkill(makeRoom([p]), 'p1', NOW);
  assert.strictEqual(speedMultiplier(p, NOW), 2, '속도증가는 2배');
  assert.strictEqual(speedMultiplier(p, NOW + 4999), 2, '5초 전까지는 2배 유지');
  assert.strictEqual(speedMultiplier(p, NOW + 5000), 1, '5초가 지나면 원래대로');

  const caster = makePlayer('c', 'slowHell', { x: 500, y: 500 });
  const victim = makePlayer('v', 'lucky', { x: 500 + 3 * METER, y: 500 });
  const far = makePlayer('f', 'lucky', { x: 500 + 20 * METER, y: 500 });
  const room = makeRoom([caster, victim, far]);
  activateSkill(room, 'c', NOW);
  assert.ok(speedMultiplier(victim, NOW) < 0.5, '반경 안의 적은 2.5배 느려져야 함');
  assert.strictEqual(speedMultiplier(far, NOW), 1, '반경 밖은 영향 없음');
  assert.ok(
    room.effects.some((fx) => fx.type === 'slowHell' && fx.playerId === 'c'),
    '속도지옥 파티클은 공용 room.effects에 생성돼야 상대방에게도 보임',
  );

  const stopper = makePlayer('s', 'timeStop', { x: 500, y: 500 });
  const frozen = makePlayer('z', 'lucky', { x: 500 + 2 * METER, y: 500 });
  activateSkill(makeRoom([stopper, frozen]), 's', NOW);
  assert.strictEqual(getSkill('timeStop').cooldownMs, 40000, '시간정지 대기시간은 40초');
  assert.strictEqual(isFrozen(frozen, NOW), true);
  assert.strictEqual(speedMultiplier(frozen, NOW), 0, '얼면 못 움직인다');
  console.log('speedUp / slowHell / timeStop change movement as specified: OK');
}

// 대쉬 — 조준 방향으로 7m 이동 + 짧은 무적. 벽은 못 뚫는다.
{
  const p = makePlayer('p1', 'dash', { x: 500, y: 500, aimX: 1, aimY: 0 });
  activateSkill(makeRoom([p]), 'p1', NOW);
  assert.ok(p.x > 500 + 6 * METER, `7m 가까이 이동해야 함 (실제 ${p.x - 500}px)`);
  assert.strictEqual(isInvulnerable(p, NOW + 400), true, '돌진 중 0.5초 무적');
  assert.strictEqual(isInvulnerable(p, NOW + 600), false, '0.5초가 지나면 무적 해제');

  const blocked = makePlayer('p2', 'dash', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const walled = makeRoom([blocked], { walls: [{ x: 560, y: 400, width: 40, height: 200 }] });
  activateSkill(walled, 'p2', NOW);
  assert.ok(blocked.x < 560, '벽을 뚫고 돌진하면 안 됨');
  console.log('dash moves forward with brief invulnerability and respects walls: OK');
}

// 충격파 — 밀쳐내고 피해.
{
  const caster = makePlayer('c', 'shockwave', { x: 500, y: 500 });
  const victim = makePlayer('v', 'lucky', { x: 500 + 2 * METER, y: 500 });
  activateSkill(makeRoom([caster, victim]), 'c', NOW);
  assert.ok(victim.x > 500 + 2 * METER, '충격파는 바깥으로 밀어내야 함');
  assert.strictEqual(victim.hp, HP_MAX - getSkill('shockwave').damagePercent);
  console.log('shockwave knocks back and damages: OK');
}

// 연행영장 — 부채꼴 안의 적만 끌어온다.
{
  const caster = makePlayer('c', 'warrant', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const front = makePlayer('f', 'lucky', { x: 500 + 5 * METER, y: 500 });
  const behind = makePlayer('b', 'lucky', { x: 500 - 5 * METER, y: 500 });
  const room = makeRoom([caster, front, behind]);
  activateSkill(room, 'c', NOW);
  assert.ok(front.x < 500 + 2 * METER, '앞쪽 적은 시전자 앞으로 끌려와야 함');
  assert.strictEqual(behind.x, 500 - 5 * METER, '뒤쪽 적은 영향 없음');
  assert.ok(room.effects.some((fx) => fx.type === 'cone' && fx.skillId === 'warrant' && fx.endsAt === NOW + 500), '연행영장 부채꼴은 현재처럼 0.5초만 표시');
  console.log('warrant pulls only the target inside the forward cone: OK');
}

// 콜드플레이 — 부채꼴 안의 모든 대상에게 피해 + 정지 + 얼음 파티클.
{
  const caster = makePlayer('c', 'coldplay', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const target1 = makePlayer('t1', 'lucky', { x: 500 + 4 * METER, y: 500 });
  const target2 = makePlayer('t2', 'lucky', { x: 500 + 5 * METER, y: 500 + METER });
  const behind = makePlayer('b', 'lucky', { x: 500 - 2 * METER, y: 500 });
  const room = makeRoom([caster, target1, target2, behind]);
  activateSkill(room, 'c', NOW);
  assert.ok(room.effects.some((fx) => fx.type === 'cone' && fx.skillId === 'coldplay' && fx.endsAt === NOW + 2000), '콜드플레이 부채꼴은 발동시간 2초 동안 표시');
  for (const target of [target1, target2]) {
    assert.strictEqual(target.hp, HP_MAX - getSkill('coldplay').damagePercent);
    assert.strictEqual(isFrozen(target, NOW + 1999), true, '2초 직전까지 움직일 수 없음');
    assert.strictEqual(speedMultiplier(target, NOW + 1999), 0, '얼은 대상의 이동 배율은 0');
    assert.ok(room.effects.some((fx) => fx.type === 'frozenIce' && fx.playerId === target.id), '대상별 얼음 박스 파티클');
  }
  assert.strictEqual(behind.hp, HP_MAX, '부채꼴 뒤쪽은 영향 없음');
  assert.strictEqual(isFrozen(behind, NOW), false);
  assert.strictEqual(isFrozen(target1, NOW + 2000), false, '2초가 되면 이동 가능');
  console.log('coldplay damages, freezes, and marks every target inside the cone: OK');
}

// 사형선고 — 표식을 남긴 사람이 때릴 때만 피해가 증폭된다.
{
  const caster = makePlayer('c', 'deathMark', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const target = makePlayer('t', 'lucky', { x: 500 + 4 * METER, y: 500 });
  const other = makePlayer('o', 'lucky');
  const room = makeRoom([caster, target, other]);
  activateSkill(room, 'c', NOW);
  assert.strictEqual(target.status.markedBy, 'c');
  const markFx = room.effects.find((fx) => fx.type === 'mark' && fx.playerId === target.id);
  const coneFx = room.effects.find((fx) => fx.type === 'cone' && fx.skillId === 'deathMark');
  assert.ok(markFx, '사형선고 과녕 표식이 공용 효과로 생성돼야 함');
  assert.strictEqual(coneFx, undefined, '사형선고는 사용 즉시 대상 과녁만 남고 시전자 부채꼴은 생성하지 않음');
  assert.strictEqual(markFx.endsAt, NOW + 15000, '선택된 대상의 과녁만 15초 유지');
  assert.notStrictEqual(markFx.ownerOnly, true, '사형선고 표식은 모든 참가자에게 보여야 함');
  const bonus = outgoingDamageMultiplier(caster, target, NOW, () => 1).multiplier;
  const none = outgoingDamageMultiplier(other, target, NOW, () => 1).multiplier;
  assert.strictEqual(bonus, getSkill('deathMark').damageBonus, '표식을 남긴 사람은 20% 증뎀');
  assert.strictEqual(none, 1, '다른 사람에게는 효과 없음');
  assert.strictEqual(
    outgoingDamageMultiplier(caster, target, NOW + 14999, () => 1).multiplier,
    getSkill('deathMark').damageBonus,
    '15초 직전까지 표식 피해 증가 유지',
  );
  assert.strictEqual(outgoingDamageMultiplier(caster, target, NOW + 15000, () => 1).multiplier, 1, '15초가 되면 표식 만료');
  console.log('deathMark amplifies damage only from the caster: OK');
}

// 운빨 — 15% 확률로 발동하며 발동시간 동안 2.5배가 유지되고 대기시간 중에는 새 추첨을 하지 않는다.
{
  const p = makePlayer('p1', 'lucky');
  const t = makePlayer('t', 'heal');
  assert.strictEqual(outgoingDamageMultiplier(p, t, NOW, () => 0.149).multiplier, 2.5, '15% 안에 들면 2.5배');
  assert.strictEqual(
    outgoingDamageMultiplier(p, t, NOW + getSkill('lucky').activationDurationMs - 1, () => 1).multiplier,
    2.5,
    '발동시간 동안은 확률을 다시 뽑지 않고 2.5배 유지',
  );
  assert.strictEqual(
    outgoingDamageMultiplier(p, t, NOW + getSkill('lucky').activationDurationMs + 1, () => 0).multiplier,
    1,
    '발동이 끝났어도 대기시간 전에는 다시 발동하지 않음',
  );
  assert.strictEqual(
    outgoingDamageMultiplier(p, t, NOW + getSkill('lucky').cooldownMs, () => 0.149).multiplier,
    2.5,
    '대기시간 뒤에는 다시 추첨 가능',
  );
  const miss = makePlayer('miss', 'lucky');
  assert.strictEqual(outgoingDamageMultiplier(miss, t, NOW, () => 0.15).multiplier, 1, '15% 경계부터는 발동하지 않음');
  console.log('lucky is a probabilistic damage multiplier: OK');
}

// 최후의 발악 — HP가 20 이하인 동안 제한 없이 유지되고, 회복/부활 시 해제.
{
  const p = makePlayer('p1', 'lastStand', { hp: 15 });
  const room = makeRoom([p, makePlayer('p2', 'lucky')]);
  tickSkillWorld(room, NOW, []);
  assert.ok(p.status.lastStandUntil > NOW, 'HP 20 이하에서 자동 발동해야 함');
  assert.strictEqual(speedMultiplier(p, NOW), getSkill('lastStand').speedMultiplier);
  assert.strictEqual(outgoingDamageMultiplier(p, room.players.p2, NOW, () => 1).multiplier, 3, '공격력 3배');
  assert.strictEqual(outgoingDamageMultiplier(p, room.players.p2, NOW + 600_000, () => 1).multiplier, 3, 'HP 20 이하면 시간 제한 없이 유지');
  assert.ok(room.effects.some((fx) => fx.type === 'lastStand' && fx.playerId === p.id), '발동 파티클 유지');

  p.hp = 30;
  tickSkillWorld(room, NOW + 600_001, []);
  assert.strictEqual(p.status.lastStandUntil, 0, 'HP가 20을 넘으면 해제');
  assert.ok(!room.effects.some((fx) => fx.type === 'lastStand' && fx.playerId === p.id), '해제 시 파티클도 제거');

  p.hp = 20;
  tickSkillWorld(room, NOW + 600_002, []);
  assert.ok(p.status.lastStandUntil > NOW, '대기시간 없이 HP 20 이하가 되면 즉시 재발동');

  room.players.p1 = { ...resetSkillsOnRespawn(p), hp: HP_MAX, alive: true };
  tickSkillWorld(room, NOW + 600_003, []);
  assert.strictEqual(room.players.p1.status.lastStandUntil, 0, '부활하면 해제된 상태');
  assert.ok(!room.effects.some((fx) => fx.type === 'lastStand' && fx.playerId === p.id), '부활 후 잔류 파티클 없음');

  const healthy = makePlayer('p3', 'lastStand', { hp: 80 });
  tickSkillWorld(makeRoom([healthy, makePlayer('p4', 'lucky')]), NOW, []);
  assert.strictEqual(healthy.status.lastStandUntil, 0, 'HP가 넉넉하면 발동하지 않음');
  console.log('lastStand stays active at HP <= 20 with no cooldown and clears on heal/respawn: OK');
}

// 지뢰 — 적이 다가오면 폭발하고, 설치자 자신은 밟아도 안 터진다.
{
  const owner = makePlayer('o', 'mine', { x: 500, y: 500 });
  const room = makeRoom([owner, makePlayer('e', 'lucky', { x: 1500, y: 1500 })]);
  activateSkill(room, 'o', NOW);
  assert.strictEqual(room.mines.length, 1);

  tickSkillWorld(room, NOW + 100, []);
  assert.strictEqual(room.mines.length, 1, '설치자가 위에 서 있어도 안 터짐');

  room.players.e.x = 505;
  room.players.e.y = 500;
  tickSkillWorld(room, NOW + 200, []);
  assert.strictEqual(room.mines.length, 0, '적이 밟으면 터져서 사라짐');
  assert.strictEqual(getSkill('mine').damagePercent, 50, '지뢰 폭발은 최대 체력의 50% 피해');
  assert.strictEqual(room.players.e.hp, HP_MAX - 50);

  const expiryRoom = makeRoom([makePlayer('owner2', 'mine'), makePlayer('far2', 'heal', { x: 1500, y: 1500 })]);
  activateSkill(expiryRoom, 'owner2', NOW);
  tickSkillWorld(expiryRoom, NOW + getSkill('mine').activationDurationMs, []);
  assert.strictEqual(expiryRoom.mines.length, 0, '지뢰는 발동시간이 끝나면 사라져야 함');
  console.log('mine explodes on enemies only: OK');
}

// 블랙홀 — 지속 시간 동안 적을 중심으로 끌어당긴다.
{
  const caster = makePlayer('c', 'blackhole', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const victim = makePlayer('v', 'lucky', { x: 500 + 5 * METER, y: 500 });
  const room = makeRoom([caster, victim]);
  activateSkill(room, 'c', NOW);
  assert.strictEqual(room.blackholes.length, 1);
  const before = victim.x;
  tickSkillWorld(room, NOW + 100, []);
  assert.ok(victim.x < before, '블랙홀 쪽으로 끌려와야 함');
  tickSkillWorld(room, NOW + 2999, []);
  assert.strictEqual(room.blackholes.length, 1, '블랙홀은 3초 직전까지 유지됨');
  tickSkillWorld(room, NOW + getSkill('blackhole').activationDurationMs + 1, []);
  assert.strictEqual(room.blackholes.length, 0, '지속 시간이 지나면 사라짐');
  console.log('blackhole pulls nearby enemies until it expires: OK');
}

// 순간이동 — 진주가 벽에 닿으면 주인이 그 자리로 간다.
{
  const p = makePlayer('p1', 'blink', { x: 500, y: 500, aimX: 1, aimY: 0 });
  const room = makeRoom([p], { walls: [{ x: 700, y: 400, width: 40, height: 200 }] });
  activateSkill(room, 'p1', NOW);
  assert.strictEqual(room.pearls.length, 1);
  for (let i = 0; i < 40 && room.pearls.length > 0; i += 1) {
    tickSkillWorld(room, NOW + 100 * (i + 1), []);
  }
  assert.strictEqual(room.pearls.length, 0, '진주는 벽에 닿으면 사라진다');
  assert.ok(p.x > 600, `벽 앞으로 순간이동해야 함 (실제 ${p.x})`);
  console.log('blink teleports the owner to where the pearl stopped: OK');
}

// 텔레포트 백 — 40초 저장, 실제 복귀한 순간부터 40초 재사용 대기.
{
  const p = makePlayer('p1', 'recall', { x: 500, y: 500 });
  const room = makeRoom([p]);
  activateSkill(room, 'p1', NOW);
  assert.strictEqual(p.status.savedX, 500, '첫 입력은 위치를 저장');
  assert.strictEqual(p.status.savedUntil, NOW + 40000, '위치는 40초 동안 저장');
  assert.strictEqual(p.skillReadyAt, 0, '첫 입력에서는 재사용 대기가 시작되지 않음');

  p.x = 1200;
  p.y = 900;
  activateSkill(room, 'p1', NOW + 39999);
  assert.strictEqual(p.x, 500, '두 번째 입력은 저장한 자리로 복귀');
  assert.strictEqual(p.skillReadyAt, NOW + 39999 + 40000, '복귀 시점부터 40초 재사용 대기');
  assert.strictEqual(activateSkill(room, 'p1', NOW + 40000), false, '복귀 후 대기시간 중에는 다시 저장할 수 없음');

  // 40초 안에 복귀하지 않으면 저장만 만료되고, 쿨타임 없이 새 위치를 저장할 수 있다.
  const q = makePlayer('q', 'recall', { x: 300, y: 300 });
  const room2 = makeRoom([q]);
  activateSkill(room2, 'q', NOW);
  q.x = 900;
  const reused = activateSkill(room2, 'q', NOW + getSkill('recall').activationDurationMs + 1);
  assert.strictEqual(reused, true, '복귀하지 않고 40초가 지나면 새 위치 저장 가능');
  assert.strictEqual(q.x, 900, '만료 후 입력은 이전 위치로 복귀하지 않음');
  assert.strictEqual(q.status.savedX, 900, '현재 위치를 새로 저장');
  console.log('recall saves a position and returns to it within the window: OK');
}

// 반사 — 공격자가 절반을 되돌려 맞는다(대상은 원래 피해를 다 받는다).
{
  const attacker = makePlayer('a', 'lucky', { x: 500, y: 500, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const target = makePlayer('t', 'reflect', { x: 545, y: 500 });
  const room = makeRoom([attacker, target]);
  activateSkill(room, 't', NOW);
  assert.ok(room.effects.some((fx) => fx.type === 'reflectAura' && fx.playerId === 't'), '반사 파티클이 공용 전투 상태에 생성돼야 함');
  // 운빨이 확률로 끼어들지 않도록 공격자를 반사 대상이 아닌 평범한 스킬로 바꾼다.
  attacker.skillId = 'heal';
  const { room: next } = stepSimulation(room, NOW);
  assert.strictEqual(next.players.t.hp, HP_MAX - 20, '반사 중에도 자신은 원래 피해를 받는다');
  assert.strictEqual(next.players.a.hp, HP_MAX - 10, '공격자는 절반(10)을 되돌려 맞는다');
  console.log('reflect returns half the damage to the attacker: OK');
}

// 독 — 다음 공격에 붙고, 이후 초당 피해를 준다.
{
  const attacker = makePlayer('a', 'poison', { x: 500, y: 500, aimX: 1, aimY: 0, hpDamage: 10, attackRequested: true });
  const target = makePlayer('t', 'heal', { x: 545, y: 500 });
  const room = makeRoom([attacker, target]);
  activateSkill(room, 'a', NOW);
  assert.ok(attacker.status.poisonArmedUntil > NOW, '독이 장전됨');
  assert.strictEqual(attacker.skillReadyAt, NOW + 20000, '독 재사용 대기시간은 20초');

  const { room: next } = stepSimulation(room, NOW);
  assert.ok(next.players.t.status.poisonedUntil > NOW, '명중하면 대상에게 독이 붙어야 함');
  assert.strictEqual(next.players.a.status.poisonArmedUntil, 0, '장전은 1회용');

  const poisoned = next.players.t;
  const hpAfterHit = poisoned.hp;
  const room2 = makeRoom([next.players.a, poisoned]);
  tickSkillWorld(room2, NOW + 1000, []);
  assert.strictEqual(getSkill('poison').dotPercentPerSec, 1.5, '독은 초당 1.5% 피해');
  assert.strictEqual(poisoned.hp, hpAfterHit - 1.5, '1초 후 1.5% 추가 피해');
  console.log('poison arms the next hit and then ticks damage over time: OK');
}

// 죽은/얼어붙은 상태에서는 스킬을 못 쓴다.
{
  const dead = makePlayer('d', 'heal', { alive: false, hp: 0, respawnAt: NOW + 5000 });
  assert.strictEqual(activateSkill(makeRoom([dead]), 'd', NOW), false, '죽은 상태에서는 스킬 사용 불가');

  const frozen = makePlayer('f', 'heal', { hp: 50 });
  frozen.status.frozenUntil = NOW + 2000;
  assert.strictEqual(activateSkill(makeRoom([frozen]), 'f', NOW), false, '얼어 있으면 스킬 사용 불가');
  console.log('skills are blocked while dead or frozen: OK');
}

// 패시브(운빨/최후의 발악)는 버튼으로 발동되지 않는다.
{
  for (const skillId of ['lucky', 'lastStand']) {
    const p = makePlayer('p1', skillId);
    assert.strictEqual(activateSkill(makeRoom([p]), 'p1', NOW), false, `${skillId}은 패시브라 버튼으로 발동하지 않음`);
  }
  console.log('passive skills cannot be manually activated: OK');
}

// 룰렛은 시간이 지나도 자동으로 끝나지 않는다. 참가자 전원이 고른 뒤 관리자가 별도
// 이벤트로 카운트다운을 시작하는 것은 socket/battle.js가 담당한다.
{
  const picked = makePlayer('a', null, { skillChoices: drawSkillChoices(9), skillIds: ['heal', 'dash', 'mine', 'shield'] });
  const idle = makePlayer('b', null, { skillChoices: ['shield', 'poison', 'blink'] });
  const room = makeRoom([picked, idle], { status: 'roulette', rouletteEndsAt: NOW });
  const { room: next } = stepSimulation(room, NOW + 60_000);
  assert.strictEqual(next.status, 'roulette', '시간이 지나도 관리자 승인 전에는 룰렛 유지');
  assert.deepStrictEqual(next.players.a.skillIds, ['heal', 'dash', 'mine', 'shield'], '고른 사람은 4개가 그대로');
  assert.strictEqual(next.players.b.skillIds, undefined, '안 고른 사람을 자동 확정하지 않음');
  console.log('roulette waits for every player and explicit admin approval: OK');
}

console.log('skillEngine.test.mjs: OK');
