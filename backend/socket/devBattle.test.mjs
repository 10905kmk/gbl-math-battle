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

handlers.get('devBattle:reset')();
assert.strictEqual(getDevBattleRoom(socket.id).players[socket.id].hp, HP_MAX);
assert.strictEqual(getDevBattleRoom(socket.id).players[socket.id].skillId, 'heal');
assert.strictEqual(getDevControlledPlayerId(socket.id), socket.id);

handlers.get('devBattle:stop')();
assert.strictEqual(getDevBattleRoom(socket.id), null, '창 종료 이벤트가 개발자 방을 제거해야 함');
assert.ok(emitted.some(([event]) => event === 'devBattle:state'));

console.log('devBattle.test.mjs: all developer skills and cleanup OK');
