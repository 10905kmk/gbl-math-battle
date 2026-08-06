import assert from 'node:assert';
import { startBattleRoom, getBattleRoom, stopBattleRoom } from './battle.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { CHARACTER_RADIUS } from '../lib/battleSimulation.js';

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
  `8명의 스폰 좌표가 모두 달라야 함(DEFAULT_MAP.spawnPoints가 최소 8개 필요), 실제 서로 다른 좌표 수 ${spawnKeys.size}`,
);

const characterIds = new Set(players.map((p) => p.characterId));
assert.strictEqual(
  characterIds.size,
  8,
  `8명의 캐릭터 id가 모두 달라야 함(CHARACTER_IDS가 최소 8개 필요), 실제 서로 다른 id 수 ${characterIds.size}`,
);

assert.ok(DEFAULT_MAP.spawnPoints.length >= 8, 'DEFAULT_MAP.spawnPoints는 최소 8개여야 함');

// 위의 두 검증(스폰 좌표/캐릭터 id가 8개 모두 다름)은 8개 항목이 서로 다른 리터럴이기만 하면
// 항상 통과하는 동어반복이라, 새 스폰 지점이 벽 안에 파묻혀도 잡아내지 못한다(Opus 리뷰
// Important I3) — battleMap.js가 "맵을 교체할 때 스폰 지점이 새 벽 배치 안에 파묻히는 사고를
// 방지"하려고 만든 파일이므로, 실제로 벽/아레나 경계와 겹치지 않는지 캐릭터 반경 기준으로
// 직접 확인한다.
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
for (const spawn of DEFAULT_MAP.spawnPoints) {
  for (const wall of DEFAULT_MAP.walls) {
    const closestX = clamp(spawn.x, wall.x, wall.x + wall.width);
    const closestY = clamp(spawn.y, wall.y, wall.y + wall.height);
    const dx = spawn.x - closestX;
    const dy = spawn.y - closestY;
    assert.ok(
      dx * dx + dy * dy >= CHARACTER_RADIUS ** 2,
      `스폰 지점 ${JSON.stringify(spawn)}이 벽 ${JSON.stringify(wall)}과 겹침(캐릭터 반경 ${CHARACTER_RADIUS})`,
    );
  }
  assert.ok(
    spawn.x >= CHARACTER_RADIUS
      && spawn.x <= DEFAULT_MAP.arenaSize.width - CHARACTER_RADIUS
      && spawn.y >= CHARACTER_RADIUS
      && spawn.y <= DEFAULT_MAP.arenaSize.height - CHARACTER_RADIUS,
    `스폰 지점 ${JSON.stringify(spawn)}이 아레나 경계 밖(또는 경계에 너무 붙음)`,
  );
}
console.log('spawn points stay clear of walls and arena bounds: OK');

stopBattleRoom();
console.log('battle.headroom.test.mjs: OK');
