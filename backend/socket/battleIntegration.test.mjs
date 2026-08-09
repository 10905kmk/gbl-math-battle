import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import {
  addBattleTime,
  BATTLE_TIME_EXTENSION_MS,
  buildBattleStatePayload,
  getBattleRoom,
  getBattleDuration,
  stopBattleRoom,
  startBattleRoom,
  startBattleCountdown,
  setBattleDuration,
  getLastStandings,
} from './battle.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX, RANGED_COMBAT_RANGE_MULTIPLIER } from '../../shapes/attackGeometry.js';

// 매 판은 5초 카운트다운으로 시작한다 — 테스트에서 라운드를 끝내려면 먼저 카운트다운을
// 지나 'active'로 만들어야 한다. 제한시간을 과거로 옮기는 것만으로는 카운트다운 중인
// 라운드가 끝나지 않는다.
function skipCountdownAndExpire(room) {
  room.status = 'active';
  room.endsAt = Date.now() - 1;
}

const handlers = {};
const emitted = [];
const resultsSentTo = {};

function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({
    emit: (ev, payload) => {
      resultsSentTo[id] = resultsSentTo[id] || [];
      resultsSentTo[id].push([ev, payload]);
    },
  }),
};

for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`p${i}`));
}

// admin:startSession(2026-08-07부터 'name' stage부터 시작)이 매 세션 시작마다
// participant:name/create:done으로 채워진 필드를 초기화하므로(참가자 모델 통합 —
// session.js의 resetRoundFields 참고), 이름/무기 입력은 반드시 admin:startSession
// 이후에 보내야 한다. create 단계까지 미리 넘겨둔다.
handlers.p1['admin:startSession'](); // -> name
handlers.p1['admin:nextStage'](); // -> learn
handlers.p1['admin:nextStage'](); // -> create

// participant:name — 이름을 먼저 보내두면 이후 create:done 때 참가자 엔트리에 반영된다.
// trim/길이 제한(20자)/비문자열 방어를 함께 확인한다 — 클라이언트 제공값을 그대로 믿지
// 않는 이 프로젝트의 기존 원칙(weaponDamage clamp 등)과 같은 이유. p4/p5는 아예 안 보내서
// "이름을 안 넣은 참가자는 null" 경로도 같이 확인한다.
handlers.p1['participant:name']('  민수  ');
handlers.p2['participant:name']('가'.repeat(50));
handlers.p3['participant:name'](12345);

for (let i = 1; i <= 5; i += 1) {
  const parts = i === 1 ? [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }] : [];
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts });
}

handlers.p1['admin:nextStage'](); // -> battle (startBattleRoom 트리거되어야 함)

const room = getBattleRoom();
assert.ok(room, 'battle room이 생성되어 있어야 함');
assert.strictEqual(Object.keys(room.players).length, 5);
// 이 참가자들의 weapon에는 attackRange가 없다(구버전 페이로드/평가 실패 등) — 그런 무기는
// 근접으로 취급되므로 MELEE_DAMAGE_MULTIPLIER(1.3)가 곱해진 값이 나온다.
// damage=1000 -> 3 + 0.1*(24-3) = 5.1 -> 근접 1.3배 = 6.6 (HP %)
assert.strictEqual(room.players.p1.hpDamage, 6.6, 'damage=1000 -> HP 5.1% -> 근접 배율 1.3 -> 6.6%');
assert.strictEqual(room.players.p5.hpDamage, 17.6, 'damage=5000 -> HP 13.5% -> 근접 배율 1.3 -> 17.6%');
assert.strictEqual(room.players.p1.hp, 90, '모든 참가자는 90 체력으로 시작');
assert.strictEqual(room.players.p1.alive, true);
assert.strictEqual(room.status, 'roulette', '매 판은 특수 스킬 룰렛으로 시작');
assert.strictEqual(room.rouletteEndsAt, null, '룰렛은 관리자가 시작할 때까지 자동 종료되지 않음');
assert.strictEqual(room.players.p1.skillChoices.length, 9, '룰렛 9칸에 후보가 채워져야 함');
assert.strictEqual(new Set(room.players.p1.skillChoices).size, 9, '9칸의 후보는 서로 달라야 함');
assert.deepStrictEqual(room.players.p1.skillIds, [], '아직 고르기 전');
console.log('battle room initialized from participants (HP model + countdown): OK');

{
  const payload = buildBattleStatePayload(room);
  assert.ok(Number.isFinite(payload.serverNow), '기기 시계와 무관한 파티클 만료 계산용 서버 시각 포함');
  assert.strictEqual(payload.walls, undefined, '정적 충돌벽은 20Hz 패킷에서 제외');
  assert.strictEqual(payload.spawnPoints, undefined, '정적 스폰 좌표는 20Hz 패킷에서 제외');
  assert.strictEqual(payload.players.p1.input, undefined, '서버 전용 입력은 패킷에서 제외');
  assert.strictEqual(payload.players.p1.recentDamagers, undefined, '서버 전용 어시스트 기록은 패킷에서 제외');
  assert.strictEqual(payload.players.p1.attackRequested, undefined, '서버 전용 공격 요청은 패킷에서 제외');
  assert.ok(payload.players.p1.weaponParts, '렌더링에 필요한 무기 정보는 유지');
  assert.ok(JSON.stringify(payload).length < JSON.stringify(room).length, '공개 상태 패킷이 내부 room보다 작아야 함');
}
console.log('battle state payload omits server-only and static data: OK');

assert.strictEqual(setBattleDuration(90_000), 90_000, '게임 시간은 30초 단위로 설정 가능');
assert.strictEqual(getBattleDuration(), 90_000);
assert.strictEqual(getBattleRoom().durationMs, 90_000, '룰렛 중 변경한 시간이 현재 판에 반영');
assert.strictEqual(setBattleDuration(180_000), 180_000, '테스트 뒤 기본 3분으로 복원');
assert.strictEqual(getBattleRoom().durationMs, 180_000);
console.log('admin configures battle duration in 30-second steps: OK');

// 일부 참가자가 선택을 끝내지 않아도 관리자가 시작할 수 있다. 이미 고른 스킬은 유지하고
// 부족한 칸만 각 참가자의 후보에서 자동 배정한 뒤 정확히 5초 카운트다운으로 넘어간다.
room.players.p1.skillIds = room.players.p1.skillChoices.slice(0, 2);
const p1ManualPicks = [...room.players.p1.skillIds];
assert.strictEqual(startBattleCountdown(1000), true, '선택 미완료 참가자가 있어도 관리자가 시작할 수 있음');
Object.values(getBattleRoom().players).forEach((p) => {
  assert.strictEqual(p.skillIds.length, 4, '모든 참가자에게 정확히 4개 스킬이 장착되어야 함');
  assert.strictEqual(new Set(p.skillIds).size, 4, '자동 배정된 스킬은 중복되면 안 됨');
  assert.strictEqual(p.skillSelectionConfirmed, true, '카운트다운 시작 시 모든 선택이 확정되어야 함');
});
assert.deepStrictEqual(getBattleRoom().players.p1.skillIds.slice(0, 2), p1ManualPicks, '참가자가 직접 고른 스킬은 유지');
assert.strictEqual(getBattleRoom().status, 'countdown', '관리자 승인 뒤 카운트다운 상태');
assert.strictEqual(getBattleRoom().countdownEndsAt, 6000, '5초 카운트다운 종료 시각');
console.log('admin can start the 5-second countdown and incomplete selections are auto-filled: OK');

{
  const currentRoom = getBattleRoom();
  const originalStatus = currentRoom.status;
  const originalEndsAt = currentRoom.endsAt;
  currentRoom.status = 'active';
  currentRoom.endsAt = 10_000;
  assert.strictEqual(addBattleTime(), true, '진행 중인 게임은 관리자가 시간을 연장할 수 있음');
  assert.strictEqual(getBattleRoom().endsAt, 10_000 + BATTLE_TIME_EXTENSION_MS, '한 번 누르면 정확히 30초 연장');
  getBattleRoom().status = originalStatus;
  getBattleRoom().endsAt = originalEndsAt;
  console.log('admin extends an active battle by 30 seconds: OK');
}

assert.strictEqual(room.players.p1.name, '민수', '앞뒤 공백은 trim되어야 함');
assert.strictEqual(room.players.p2.name, '가'.repeat(20), '20자를 넘는 이름은 잘려야 함');
assert.strictEqual(room.players.p3.name, null, '문자열이 아닌 이름은 무시되고 null이어야 함');
assert.strictEqual(room.players.p4.name, null, '이름을 아예 안 보낸 참가자는 null');
console.log('participant names flow from participant:name through create:done into battleRoom.players: OK');

assert.deepStrictEqual(room.arenaSize, DEFAULT_MAP.arenaSize, 'battle room의 arenaSize가 DEFAULT_MAP.arenaSize와 일치해야 함');
console.log('battle room carries arenaSize from DEFAULT_MAP: OK');

assert.deepStrictEqual(
  room.players.p1.weaponParts,
  [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
  'p1의 weapon.parts가 battleRoom.players.p1.weaponParts로 그대로 전달되어야 함',
);
assert.deepStrictEqual(room.players.p2.weaponParts, [], '무기 부품이 없으면 빈 배열이어야 함');
console.log('battle room carries weaponParts from participant weapon: OK');

// battle:input 핸들러가 등록돼 있는지 확인 (registerBattleHandlers는 registerSessionHandlers와
// 별개로 server.js가 호출하지만, 여기선 핸들러 자체를 직접 불러서 크래시 여부만 검증)
{
  const { registerBattleHandlers } = await import('./battle.js');
  const battleHandlers = {};
  // registerBattleHandlers는 등록 시점에 현재 대시보드/이동속도를 socket.emit으로 바로
  // 내려주므로(신규 접속 동기화) 목 소켓에도 emit이 있어야 한다.
  const testSocket = { id: 'p1', on: (ev, fn) => { battleHandlers[ev] = fn; }, emit: () => {} };
  registerBattleHandlers(io, testSocket);

  // 서버에서도 9개 후보 밖/최대 4개 조작을 막고, 선택 카드를 다시 누르면 해제한다.
  const current = getBattleRoom();
  const savedStatus = current.status;
  current.status = 'roulette';
  current.players.p1.skillChoices = ['heal', 'shield', 'dash', 'mine', 'blink', 'poison', 'recall', 'coldplay', 'lucky'];
  current.players.p1.skillIds = [];
  current.players.p1.skillSelectionConfirmed = false;
  for (const id of ['heal', 'shield', 'dash', 'mine', 'blink']) battleHandlers['battle:pickSkill'](id);
  assert.deepStrictEqual(current.players.p1.skillIds, ['heal', 'shield', 'dash', 'mine'], '선택은 최대 4개');
  battleHandlers['battle:pickSkill']('not-a-choice');
  assert.strictEqual(current.players.p1.skillIds.length, 4, '후보 밖 스킬은 무시');
  battleHandlers['battle:pickSkill']('dash');
  assert.deepStrictEqual(current.players.p1.skillIds, ['heal', 'shield', 'mine'], '다시 누르면 선택 해제');
  battleHandlers['battle:pickSkill']('blink');
  assert.strictEqual(current.players.p1.skillSelectionConfirmed, false, '카드 선택만으로 자동 확정되지 않음');
  battleHandlers['battle:confirmSkills']();
  assert.strictEqual(current.players.p1.skillSelectionConfirmed, true, '4개 선택 뒤 별도 확정 이벤트로 준비 완료');
  current.status = 'active';

  // Z/X/C/V가 보내는 id는 장착한 4개일 때만 발동하고 쿨타임은 스킬별로 독립적이다.
  current.players.p1.hp = 40;
  battleHandlers['battle:skill']('heal');
  assert.strictEqual(current.players.p1.hp, 70, '장착한 힐 발동');
  assert.ok(current.players.p1.skillReadyAts.heal > Date.now(), '힐 쿨타임 저장');
  battleHandlers['battle:skill']('dash');
  assert.strictEqual(current.players.p1.skillReadyAts.dash, undefined, '장착하지 않은 스킬은 발동 불가');
  battleHandlers['battle:skill']('mine');
  assert.ok(current.players.p1.skillReadyAts.mine > Date.now(), '다른 스킬은 힐 쿨타임과 무관하게 발동');
  current.status = savedStatus;

  // 빈 payload/undefined/null이 와도 크래시하지 않아야 함
  assert.doesNotThrow(() => battleHandlers['battle:input'](undefined), 'input이 undefined');
  assert.doesNotThrow(() => battleHandlers['battle:input'](null), 'input이 null');
  assert.doesNotThrow(() => battleHandlers['battle:input']({}), 'input이 빈 객체');
  console.log('battle:input tolerates malformed payload: OK');

  // 정상 입력은 실제로 반영되는지도 같이 확인
  battleHandlers['battle:input']({ moveX: 1, moveY: 0, aimX: 1, aimY: 0 });
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 1);
  assert.strictEqual(getBattleRoom().players.p1.input.aimX, 1);
  battleHandlers['battle:input'](undefined);
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 0, 'undefined는 전부 0으로 취급');

  // battle:attack — 1회성 공격 요청. 페이로드 없이 emit되고 attackRequested만 세팅한다.
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, false, '초기값은 false');
  battleHandlers['battle:attack']();
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, true, 'battle:attack 수신 시 attackRequested가 true로 세팅됨');
  console.log('battle:attack sets attackRequested: OK');

  // 연결이 끊기면 해당 참가자는 조작 불가 상태로 처리되어야 한다(더 이상 "죽는" 개념은 없음).
  battleHandlers['disconnect']();
  assert.strictEqual(getBattleRoom().players.p1.connected, false, '연결 끊긴 참가자는 connected=false');
  console.log('disconnect marks player as not connected: OK');
}

// 한 팀이 여러 판을 도는 운영 방식(2026-08-09)이라, 판이 자연 종료되면 순위 대시보드만
// 뜨고 stage는 battle에 머문다 — 결과 저장과 result 단계 전환은 관리자가 "부스 종료"를
// 누를 때 한 번만 일어난다. 매 판 저장하면 QR이 어느 판을 가리키는지 알 수 없어진다.
{
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  skipCountdownAndExpire(getBattleRoom());
  await new Promise((resolve) => setTimeout(resolve, 150)); // 다음 틱(50ms)이 지나가길 대기

  console.warn = origWarn;

  assert.strictEqual(getBattleRoom(), null, '라운드 종료 후 battleRoom은 null이어야 함');

  const stageChanges = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(stageChanges, ['name', 'learn', 'create', 'battle'], '자연 종료로는 stage가 안 넘어간다');
  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    0,
    '판이 끝났다고 바로 저장하면 안 된다 — 여러 판을 돌 수 있으므로 저장은 부스 종료 때 한 번만',
  );

  const standings = getLastStandings();
  assert.ok(standings, '판이 끝나면 최종 순위 대시보드 데이터가 생겨야 함');
  assert.strictEqual(standings.standings.length, 5);
  assert.ok(
    standings.standings.every((p) => p.kills === 0 && p.deaths === 0 && p.assists === 0 && p.score === 0),
    '아무도 공격하지 않았으므로 전원 0킬 0데스 0점',
  );
  assert.ok(
    emitted.some(([ev, payload]) => ev === 'battle:standings' && payload && payload.standings),
    '순위표가 전체에게 브로드캐스트되어야 함',
  );
  console.log('round end shows the standings dashboard without saving or advancing: OK');

  // 이제 관리자가 "부스 종료" — 마지막 판 점수로 저장하고 결과 단계로 넘어간다.
  const warnings2 = [];
  console.warn = (...args) => { warnings2.push(args.join(' ')); };
  handlers.p1['admin:endBooth']();
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.warn = origWarn;

  assert.deepStrictEqual(
    emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s),
    ['name', 'learn', 'create', 'battle', 'result'],
    '부스 종료를 누르면 결과 단계로 넘어간다',
  );
  assert.strictEqual(
    warnings2.filter((w) => w.includes('mock 저장')).length,
    5,
    '부스 종료 시 참가자 5명 각각에 대해 결과 저장이 시도되어야 함',
  );
  console.log('admin:endBooth saves the last round and advances to the result stage: OK');
}

// 회귀 테스트: 대전 도중 참가자가 연결을 끊어도(session.js의 disconnect 핸들러가
// cohort.participants에서 그 참가자를 제거함) 결과 저장은 대전 시작 시점 스냅샷 기준으로
// 여전히 전원에 대해 시도되어야 한다 — 안 그러면 연결이 끊긴 참가자는 결과를 영영 잃는다
// (Opus 리뷰 Important #3).
{
  handlers.p1['admin:reset']();
  handlers.p1['admin:startSession'](); // -> name
  handlers.p1['admin:nextStage'](); // -> learn
  handlers.p1['admin:nextStage'](); // -> create
  for (let i = 1; i <= 5; i += 1) {
    handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
  }
  handlers.p1['admin:nextStage'](); // -> battle

  assert.ok(getBattleRoom(), '재시작된 battle room이 있어야 함');

  // session.js의 disconnect 핸들러 — cohort.participants에서 p3를 제거한다.
  handlers.p3['disconnect']();

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  skipCountdownAndExpire(getBattleRoom());
  await new Promise((resolve) => setTimeout(resolve, 150));
  handlers.p1['admin:endBooth']();
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.warn = origWarn;

  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    5,
    '대전 도중 연결이 끊긴 p3를 포함해 대전 시작 시점 참가자 5명 전원에 대해 저장이 시도되어야 함',
  );
  console.log('disconnect during battle does not lose result storage: OK');
}

// 여러 판 운영: 대시보드에서 "새로운 판"을 누르면 같은 참가자/무기로 즉시 다음 라운드가
// 시작된다(제작 단계로 되돌아가지 않는다).
{
  handlers.p1['admin:reset']();
  handlers.p1['admin:startSession']();
  handlers.p1['admin:nextStage'](); // -> learn
  handlers.p1['admin:nextStage'](); // -> create
  for (let i = 1; i <= 5; i += 1) {
    handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
  }
  handlers.p1['admin:nextStage'](); // -> battle (1판)
  const firstRound = getBattleRoom().round;

  skipCountdownAndExpire(getBattleRoom());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(getBattleRoom(), null, '1판이 끝나 대시보드 상태');

  handlers.p1['admin:newRound']();
  const second = getBattleRoom();
  assert.ok(second, '새로운 판이 시작되어야 함');
  assert.strictEqual(second.round, firstRound + 1, '판 번호가 1 올라가야 함');
  assert.strictEqual(second.status, 'roulette', '새 판도 룰렛부터 다시 시작');
  assert.strictEqual(Object.keys(second.players).length, 5, '같은 참가자로 다시 시작');
  assert.ok(
    Object.values(second.players).every((p) => p.hp === 90 && p.kills === 0 && p.deaths === 0),
    '새 판은 체력/기록이 전부 초기화된 상태로 시작',
  );
  assert.strictEqual(getLastStandings(), null, '새 판이 시작되면 이전 대시보드는 내려간다');
  console.log('admin:newRound restarts the same roster for another round: OK');

  // 이동 속도는 판이 바뀌어도 유지된다 — 관리자가 매 판 다시 맞출 이유가 없다.
  const { registerBattleHandlers } = await import('./battle.js');
  const bh = {};
  registerBattleHandlers(io, { id: 'admin-sock', on: (ev, fn) => { bh[ev] = fn; }, emit: () => {} });
  bh['admin:setMoveSpeed'](12);
  assert.strictEqual(getBattleRoom().moveSpeed, 12, '진행 중인 판에도 즉시 반영되어야 함');
  bh['admin:setMoveSpeed'](9999);
  assert.ok(getBattleRoom().moveSpeed < 100, '비정상적으로 큰 값은 상한으로 clamp');
  console.log('admin:setMoveSpeed applies live to the running round: OK');

  handlers.p1['admin:reset']();
}

// 회귀 테스트: battle.js의 onEnd 콜백이 최종 점수 스냅샷을 정확히 전달하는지 직접 확인
// (Opus 리뷰 Important I4 — 기존 통합 테스트는 저장 "시도 횟수"만 셌지, session.js로 넘어가는
// scores 값 자체가 종료 시점 점수와 정확히 일치하는지는 검증하지 않았음).
{
  let onEndArgs = null;
  startBattleRoom(io, [{ id: 'sc1', weapon: { damage: 1000 } }, { id: 'sc2', weapon: { damage: 2000 } }], {
    onEnd: (winners, scores, kda) => { onEndArgs = { winners, scores, kda }; },
  });
  const scoreRoom = getBattleRoom();
  // 점수는 이제 킬/데스/어시스트에서 파생된다(킬 20, 데스 -10, 어시 5).
  Object.assign(scoreRoom.players.sc1, { kills: 3, deaths: 1, assists: 2 }); // 60-10+10 = 60
  Object.assign(scoreRoom.players.sc2, { kills: 1, deaths: 3, assists: 0 }); // 20-30 = -10
  skipCountdownAndExpire(scoreRoom);
  // 자연 종료는 저장을 안 하므로(여러 판 운영) onEnd를 보려면 부스 종료 경로를 타야 한다.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const { saveLastRoundResults } = await import('./battle.js');
  saveLastRoundResults((winners, scores, kda) => { onEndArgs = { winners, scores, kda }; });

  assert.ok(onEndArgs, 'onEnd이 호출되어야 함');
  assert.deepStrictEqual(onEndArgs.scores, { sc1: 60, sc2: -10 }, 'onEnd의 scores가 K/D/A로 계산된 최종 점수와 일치해야 함');
  assert.deepStrictEqual(onEndArgs.winners, ['sc1'], 'sc1(60점)이 sc2(-10점)보다 높으므로 단독 승자');
  assert.deepStrictEqual(
    onEndArgs.kda,
    { sc1: { kills: 3, deaths: 1, assists: 2 }, sc2: { kills: 1, deaths: 3, assists: 0 } },
    'onEnd의 kda가 라운드 종료 시점 킬/데스/어시스트 스냅샷과 일치해야 함(2026-08-10)',
  );
  console.log('battle.js onEnd callback delivers accurate score + kda snapshot: OK');
}

// 회귀: startBattleRoom이 weapon.attackRange/attackRangeDistance를 읽어 플레이어 상태에
// 정확히 반영하는지 직접 확인 — 근접은 데미지 배율이 붙고, 원거리는 AI가 정한 사거리를
// 그대로 갖는다.
{
  startBattleRoom(io, [
    { id: 'r1', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 400 } },
    { id: 'm1', weapon: { damage: 1000, attackRange: 'melee' } },
  ]);
  const room = getBattleRoom();
  assert.strictEqual(room.players.r1.isRanged, true);
  assert.strictEqual(room.players.r1.rangeDistance, 400 * RANGED_COMBAT_RANGE_MULTIPLIER);
  assert.strictEqual(room.players.r1.hpDamage, 5.1, '원거리는 배율 없이 HP 5.1% 그대로');

  assert.strictEqual(room.players.m1.isRanged, false);
  assert.strictEqual(room.players.m1.rangeDistance, null);
  assert.strictEqual(room.players.m1.hpDamage, 6.6, '근접은 5.1 * 1.3 = 6.6(반올림)');
  assert.deepStrictEqual(room.projectiles, [], 'projectiles는 빈 배열로 시작');
  console.log('startBattleRoom applies isRanged/rangeDistance/melee damage multiplier from weapon.attackRange: OK');
}

// 방어: attackRange가 이상한 값이거나 attackRangeDistance가 범위 밖/비숫자여도 안전하게
// 처리된다(근접으로 취급 / 사거리는 clamp).
{
  startBattleRoom(io, [
    { id: 'x1', weapon: { damage: 1000, attackRange: 'not-a-real-type' } },
    { id: 'x2', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 999999 } },
    { id: 'x3', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 'huge' } },
  ]);
  const room2 = getBattleRoom();
  assert.strictEqual(room2.players.x1.isRanged, false, '알 수 없는 attackRange 값은 근접으로 취급');
  assert.strictEqual(room2.players.x2.rangeDistance, RANGE_DISTANCE_MAX * RANGED_COMBAT_RANGE_MULTIPLIER, '범위를 넘는 사거리는 전투 상한으로 clamp 후 실전 배율 적용');
  assert.strictEqual(room2.players.x3.rangeDistance, RANGE_DISTANCE_MIN * RANGED_COMBAT_RANGE_MULTIPLIER, '숫자가 아닌 사거리는 전투 하한으로 대체 후 실전 배율 적용');
  console.log('startBattleRoom defends against malformed attackRange/attackRangeDistance: OK');
}

// 회귀 테스트(2026-08-07 Opus 리뷰): 관리자가 라운드 타이머 만료를 기다리지 않고 수동으로
// battle 단계를 벗어나도(admin:nextStage) 결과 저장/battle:result가 스킵되면 안 된다 —
// stopBattleRoom()만 부르면 tick interval만 죽고 onEnd가 전혀 안 불려서 참가자 전원이
// "결과 집계 중..."에 영구히 멈추는 버그였다.
{
  handlers.p1['admin:reset']();
  handlers.p1['admin:startSession'](); // -> name
  handlers.p1['admin:nextStage'](); // -> learn
  handlers.p1['admin:nextStage'](); // -> create
  for (let i = 1; i <= 5; i += 1) {
    handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
  }
  handlers.p1['admin:nextStage'](); // -> battle
  assert.ok(getBattleRoom(), '수동 전환 테스트용 battle room이 있어야 함');

  for (const key of Object.keys(resultsSentTo)) delete resultsSentTo[key];
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  // 타이머 만료 전에(endsAt이 아직 미래) 관리자가 수동으로 다음 단계를 눌러 battle을 벗어남.
  handlers.p1['admin:nextStage'](); // battle -> result (수동, 라운드 도중)

  // saveParticipantResults는 참가자별로 순차 await한다(동시 요청 시 JWT 오류 회피 —
  // resultStorage.js 참고) — admin:nextStage()가 동기로 반환된 직후엔 아직 첫 참가자
  // 저장만 끝났을 수 있으므로, 나머지가 마저 완료될 시간을 준다.
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.warn = origWarn;

  assert.strictEqual(getBattleRoom(), null, '수동 전환으로도 battleRoom은 정리되어야 함');
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(
      resultsSentTo[`p${i}`]?.some(([ev]) => ev === 'battle:result'),
      `p${i}는 수동 전환으로 대전이 끝나도 battle:result를 받아야 함`,
    );
  }
  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    5,
    '수동 전환으로 대전이 끝나도 참가자 5명 전원에 대해 결과 저장이 시도되어야 함',
  );
  console.log('admin manually advancing past an active battle still saves results and emits battle:result: OK');
}

// 대비: admin:reset은 여전히 "그냥 폐기"다 — 라운드 도중 강제 리셋은 결과를 저장하지 않는다
// (신뢰할 수 없는 중간 상태를 그대로 남기고 싶지 않다는 의도적 선택 — 수동 단계 전환과는
// 의미가 다르다).
{
  handlers.p1['admin:reset']();
  handlers.p1['admin:startSession'](); // -> name
  handlers.p1['admin:nextStage'](); // -> learn
  handlers.p1['admin:nextStage'](); // -> create
  for (let i = 1; i <= 5; i += 1) {
    handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
  }
  handlers.p1['admin:nextStage'](); // -> battle
  assert.ok(getBattleRoom(), '리셋 테스트용 battle room이 있어야 함');

  for (const key of Object.keys(resultsSentTo)) delete resultsSentTo[key];
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  handlers.p1['admin:reset'](); // 라운드 도중 강제 리셋

  console.warn = origWarn;

  assert.strictEqual(getBattleRoom(), null, 'admin:reset도 battleRoom은 정리해야 함');
  assert.deepStrictEqual(resultsSentTo, {}, 'admin:reset은 battle:result를 보내지 않아야 함(그냥 폐기)');
  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    0,
    'admin:reset은 결과 저장을 시도하지 않아야 함',
  );
  console.log('admin:reset still discards an in-progress battle without saving results: OK');
}

stopBattleRoom();
console.log('battleIntegration.test.mjs: OK');
