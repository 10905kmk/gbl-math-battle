import assert from 'node:assert';
import { registerDevBattleHandlers, getDevBattleRoom, getDevControlledPlayerId } from './devBattle.js';
import { SKILLS } from '../../shapes/skills.js';
import { HP_MAX } from '../lib/battleSimulation.js';

const handlers = new Map();
const emitted = [];
const socket = {
  id: 'developer-test-socket',
  on(event, handler) { handlers.set(event, handler); },
  emit(event, payload) { emitted.push([event, payload]); },
};

registerDevBattleHandlers(socket);
handlers.get('devBattle:start')();

let room = getDevBattleRoom(socket.id);
assert.ok(room, '개발자 시작 이벤트가 독립 방을 만들어야 함');
assert.strictEqual(room.status, 'active');
assert.strictEqual(Object.keys(room.players).length, 4, '개발자 1명과 테스트 표적 3명이 있어야 함');
assert.strictEqual(room.players[socket.id].skillId, 'heal');
assert.strictEqual(getDevControlledPlayerId(socket.id), socket.id);

// 회귀 테스트(Opus 리뷰 Minor #8, 2026-08-10): devBattle.js가 battle.js의 buildPlayer를
// 공유하도록 리팩터한 뒤로는, 예전에 손으로 복제하다 빠뜨렸던 필드(skillIds/
// skillSelectionConfirmed/skillReadyAts)도 실전 배틀과 똑같이 채워져야 한다. 근접
// 데미지 배율(MELEE_DAMAGE_MULTIPLIER)도 이제 실전과 동일하게 적용된다.
assert.deepStrictEqual(room.players[socket.id].skillIds, [], '실전 배틀과 같은 형태의 skillIds 필드가 있어야 함');
assert.strictEqual(room.players[socket.id].skillSelectionConfirmed, false);
assert.deepStrictEqual(room.players[socket.id].skillReadyAts, {});
assert.ok(room.players[socket.id].hpDamage > 0, '근접 배율이 적용된 hpDamage여야 함(0보다 커야 함)');
console.log('devBattle players share the same schema as real battle players: OK');

for (const skill of SKILLS) {
  handlers.get('devBattle:selectSkill')(skill.id);
  room = getDevBattleRoom(socket.id);
  assert.strictEqual(room.players[socket.id].skillId, skill.id, `${skill.id}를 개발자 모드에서 선택 가능해야 함`);
}
assert.strictEqual(SKILLS.length, 19, '광전사 제거 후 등록된 19개 스킬을 모두 테스트해야 함');
assert.ok(!SKILLS.some((skill) => skill.id === 'berserk'), '광전사는 개발자 테스트 목록에서도 제거');

const targetId = Object.keys(room.players).find((id) => id !== socket.id);
handlers.get('devBattle:controlPlayer')(targetId);
assert.strictEqual(getDevControlledPlayerId(socket.id), targetId, '다른 아바타로 조종 대상을 전환할 수 있어야 함');
handlers.get('devBattle:selectSkill')('dash');
assert.strictEqual(getDevBattleRoom(socket.id).players[targetId].skillId, 'dash');
assert.strictEqual(getDevBattleRoom(socket.id).players[socket.id].skillId, 'lastStand', '아바타별 스킬 상태는 독립적이어야 함');

handlers.get('devBattle:lowHp')();
assert.strictEqual(getDevBattleRoom(socket.id).players[targetId].hp, Math.floor(HP_MAX * 0.15));

getDevBattleRoom(socket.id).players[targetId].skillReadyAt = Date.now() + 999_999;
handlers.get('devBattle:resetCooldown')();
assert.strictEqual(getDevBattleRoom(socket.id).players[targetId].skillReadyAt, 0);

// 빠른 연속 테스트에서 이전 스킬 흔적이 누적되지 않아야 한다.
handlers.get('devBattle:selectSkill')('shield');
handlers.get('devBattle:skill')();
room = getDevBattleRoom(socket.id);
assert.ok(room.effects.length > 0, '테스트 스킬 파티클 생성');
room.mines.push({ id: 'old-mine', ownerId: targetId, endsAt: Date.now() + 10_000 });
room.blackholes.push({ id: 'old-blackhole', ownerId: targetId, endsAt: Date.now() + 10_000 });
room.projectiles.push({ id: 'old-projectile' });
handlers.get('devBattle:resetCooldown')();
room = getDevBattleRoom(socket.id);
assert.deepStrictEqual(room.effects, [], '쿨타임 초기화 시 이전 파티클 정리');
assert.deepStrictEqual(room.mines, [], '쿨타임 초기화 시 지뢰 정리');
assert.deepStrictEqual(room.blackholes, [], '쿨타임 초기화 시 블랙홀 정리');
assert.deepStrictEqual(room.projectiles, [], '쿨타임 초기화 시 투사체 정리');

handlers.get('devBattle:reset')();
assert.strictEqual(getDevBattleRoom(socket.id).players[socket.id].hp, HP_MAX);
assert.strictEqual(getDevBattleRoom(socket.id).players[socket.id].skillId, 'heal');
assert.strictEqual(getDevControlledPlayerId(socket.id), socket.id);

handlers.get('devBattle:stop')();
assert.strictEqual(getDevBattleRoom(socket.id), null, '창 종료 이벤트가 개발자 방을 제거해야 함');
assert.ok(emitted.some(([event]) => event === 'devBattle:state'));

console.log('devBattle.test.mjs: all developer skills and cleanup OK');
