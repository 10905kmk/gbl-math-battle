import assert from 'node:assert';
import { startBattleRoom, getBattleRoom, stopBattleRoom } from './battle.js';
import { SPAWN_POINTS } from '../lib/battleMap.js';

// 실제 예상 인원은 3~6명이지만, 스폰 지점/캐릭터는 8명까지 여유를 두기로 했다
// (2026-08-05 참가 인원 유동화 설계 문서) — 8명이 참가해도 스폰 좌표와 캐릭터가 겹치면
// 안 된다는 걸 직접 확인한다.
const io = { emit: () => {}, to: () => ({ emit: () => {} }) };

const participants = Array.from({ length: 8 }, (_, i) => ({ id: `h${i + 1}`, weapon: { damage: 1000 } }));
startBattleRoom(io, participants);

const room = getBattleRoom();
assert.strictEqual(Object.keys(room.players).length, 8, '8명 전원이 battle room에 등록되어야 함');

const players = Object.values(room.players);
const spawnKeys = new Set(players.map((p) => `${p.x},${p.y}`));
assert.strictEqual(
  spawnKeys.size,
  8,
  `8명의 스폰 좌표가 모두 달라야 함(SPAWN_POINTS가 최소 8개 필요), 실제 서로 다른 좌표 수 ${spawnKeys.size}`,
);

const characterIds = new Set(players.map((p) => p.characterId));
assert.strictEqual(
  characterIds.size,
  8,
  `8명의 캐릭터 id가 모두 달라야 함(CHARACTER_IDS가 최소 8개 필요), 실제 서로 다른 id 수 ${characterIds.size}`,
);

assert.ok(SPAWN_POINTS.length >= 8, 'SPAWN_POINTS는 최소 8개여야 함');

stopBattleRoom();
console.log('battle.headroom.test.mjs: OK');
