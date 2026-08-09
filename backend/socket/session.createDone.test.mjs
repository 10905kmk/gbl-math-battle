import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  // registerSessionHandlers는 등록 시점에 여러 socket.emit(...)을 바로 호출한다
  // (신규 접속 동기화 기능) — 목 소켓에도 emit이 있어야 한다.
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
// battle 라운드가 실제로 시작/종료되므로(session.js가 startBattleRoom을 호출)
// io.to(id).emit(...)까지 흉내낼 수 있어야 한다.
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: () => ({ emit: () => {} }),
};

function stageChanges() {
  return emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
}

function latestParticipants() {
  return emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
}

function countAdminParticipantsEmits() {
  return emitted.filter(([ev]) => ev === 'admin:participants').length;
}

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['participant:join']();
}

// admin:startSession -> 'name' (2026-08-07 설계: 더 이상 'learn'으로 직행하지 않는다 —
// 기기를 새로고침 없이 계속 켜두므로 매 라운드 이름을 다시 받아야 해서 실제 stage로
// 승격시켰다).
handlers.s1['admin:startSession']();
assert.deepStrictEqual(stageChanges(), ['name'], "admin:startSession은 이제 'name' 단계부터 시작해야 함");

// 'name' -> 'learn' -> 'create'는 모두 관리자 수동 전환.
handlers.s1['admin:nextStage'](); // -> learn
handlers.s1['admin:nextStage'](); // -> create
assert.deepStrictEqual(stageChanges(), ['name', 'learn', 'create']);

// 회귀 테스트: create:done을 전원이 보내도 더 이상 자동으로 battle로 넘어가면 안 된다
// (2026-08-07 설계 — create -> battle 전환도 관리자 수동 전환으로 바뀜).
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['create:done']({ damage: 1000 * i });
}
assert.deepStrictEqual(
  stageChanges(),
  ['name', 'learn', 'create'],
  '전원이 create:done을 보내도 자동으로 battle로 전환되면 안 됨 — 관리자가 다음 단계를 눌러야만 전환',
);

// 관리자가 수동으로 다음 단계를 누르면 그제서야 battle로 전환된다.
handlers.s1['admin:nextStage'](); // -> battle
assert.deepStrictEqual(stageChanges(), ['name', 'learn', 'create', 'battle']);
console.log('name/create stage transitions are manual-only (no auto-transition on completion): OK');

// 진행도(create:progress)는 여전히 완료 수만큼 정확히 브로드캐스트되어야 한다.
{
  const progressEvents = emitted.filter(([ev]) => ev === 'create:progress').map(([, p]) => p);
  assert.deepStrictEqual(
    progressEvents.map((p) => p.done),
    [0, 1, 2, 3, 4, 5],
    'admin:startSession 직후 done:0 브로드캐스트 + create:done마다 done count가 하나씩 늘며 브로드캐스트되어야 함',
  );
  assert.ok(progressEvents.every((p) => p.total === 5));
  console.log('create:progress broadcasts accurate done count: OK');
}

// admin:participants가 참가자별 이름/제작 완료 상태를 정확히 담아 브로드캐스트되어야 한다.
{
  const participants = latestParticipants();
  assert.strictEqual(participants.length, 5);
  assert.ok(participants.every((p) => p.createDone === true));
  assert.ok(participants.every((p) => p.weapon != null));
  console.log('admin:participants reflects per-participant createDone/weapon: OK');
}

// participant:name이 admin:participants에 반영되어야 한다.
{
  handlers.s1['participant:name']('철수');
  const participants = latestParticipants();
  const s1 = participants.find((p) => p.id === 's1');
  assert.strictEqual(s1.name, '철수');
console.log('participant:name updates admin:participants: OK');

// 새로고침한 참가자는 저장된 닉네임을 participant:join에 함께 보내므로 이름 없는
// 엔트리가 먼저 노출되지 않고 첫 관리자 브로드캐스트부터 닉네임이 유지되어야 한다.
{
  registerSessionHandlers(io, makeSocket('nickname-reconnect'));
  handlers['nickname-reconnect']['participant:join']({ name: '  유지되는 이름  ' });
  const participant = latestParticipants().find((p) => p.id === 'nickname-reconnect');
  assert.strictEqual(participant.name, '유지되는 이름');
  handlers['nickname-reconnect']['disconnect']();
}
console.log('participant:join atomically restores a persisted nickname: OK');
}

// 무기 이름은 참가자가 직접 입력하는 값이라 서버에서 다시 다듬는다 — Supabase를 거쳐
// 결과 상시 페이지와 PDF 증서의 제목으로 그대로 렌더링되기 때문(session.js sanitizeWeaponName).
{
  const weaponOf = (id) => latestParticipants().find((p) => p.id === id).weapon;

  handlers.s1['create:done']({ damage: 500, name: '   ' });
  assert.strictEqual(weaponOf('s1').name, '이름 없는 무기', '공백뿐인 이름은 대체 이름으로 바뀌어야 함');

  handlers.s1['create:done']({ damage: 500, name: `  창${'가'.repeat(40)}  ` });
  const trimmed = weaponOf('s1').name;
  assert.strictEqual(trimmed.length, 24, '무기 이름은 24자로 잘려야 함');
  assert.ok(trimmed.startsWith('창'), '앞뒤 공백은 제거되어야 함');

  handlers.s1['create:done']({ damage: 500, name: { evil: true } });
  assert.strictEqual(weaponOf('s1').name, '이름 없는 무기', '문자열이 아닌 이름은 대체 이름으로 바뀌어야 함');

  handlers.s1['create:done']('무기가 아닌 값');
  assert.strictEqual(weaponOf('s1').name, '기본 무기', '객체가 아닌 페이로드는 기본 무기로 대체되어야 함');

  // 뒤 블록들이 깨끗한 상태에서 시작하도록 정상 무기로 되돌려 놓는다.
  handlers.s1['create:done']({ damage: 1000, name: '시에르핀스키 창' });
  assert.strictEqual(weaponOf('s1').name, '시에르핀스키 창');
  console.log('create:done sanitizes participant-supplied weapon names: OK');
}

// 회귀 테스트: 참가자가 새로고침해서 소켓이 바뀌어도(옛 소켓 disconnect + 새 소켓으로
// 재등록) 중복으로 카운트되면 안 된다(Opus 리뷰 Critical #2b, 실제로 재현됨) — 통합된
// cohort.participants 모델에서도 그대로 성립해야 한다.
{
  handlers.s1['admin:reset']();
  emitted.length = 0;
  // admin:reset은 참가자 엔트리 자체(연결 상태)는 지우지 않고 이번 라운드 필드만
  // 초기화한다(기기가 새로고침 없이 계속 켜져 있다는 전제 — 2026-08-07 설계 문서
  // B 참고). 이 테스트는 "완전히 새로운 5명 세션"을 검증하려는 것이므로, 이전
  // 참가자들의 기기가 실제로 연결을 끊었다고 명시적으로 흉내낸다.
  for (let i = 1; i <= 5; i += 1) {
    handlers[`s${i}`]['disconnect']();
  }
  for (let i = 1; i <= 5; i += 1) {
    registerSessionHandlers(io, makeSocket(`r${i}`));
  }
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['participant:join']();
  }
  handlers.r1['admin:startSession']();
  handlers.r1['admin:nextStage'](); // -> learn
  handlers.r1['admin:nextStage'](); // -> create

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const refreshedId = `r1-refresh${attempt}`;
    handlers.r1['disconnect']();
    registerSessionHandlers(io, makeSocket(refreshedId));
    handlers[refreshedId]['participant:join']();
    handlers[refreshedId]['create:done']({ damage: 100 });
    handlers.r1 = handlers[refreshedId];

    const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)[1];
    assert.strictEqual(
      latestProgress.done,
      1,
      `refresh ${attempt}회차 이후에도 완료 인원은 1명(r1 본인)이어야 함 — 유령 참가자가 쌓이면 안 됨`,
    );
  }

  for (let i = 2; i <= 5; i += 1) {
    handlers[`r${i}`]['create:done']({ damage: 100 });
  }
  handlers.r1['admin:nextStage'](); // -> battle (수동)

  assert.deepStrictEqual(
    stageChanges(),
    ['name', 'learn', 'create', 'battle'],
    '참가자 1명이 4번 새로고침해도 실제 완료 인원은 5명(새로고침한 1명 + 4명)이어야 하고, 관리자가 눌러야 battle로 전환됨',
  );
  console.log('refresh churn does not double-count participants: OK');
}

// admin:forceFinish — 미완료 참가자를 기본 무기로 강제 마감.
{
  handlers.r1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['disconnect']();
  }
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`f${i}`));
    handlers[`f${i}`]['participant:join']();
  }
  handlers.f1['admin:startSession']();
  handlers.f1['admin:nextStage'](); // -> learn
  handlers.f1['admin:nextStage'](); // -> create

  handlers.f1['create:done']({ damage: 500 });
  // f2, f3은 제작을 안 끝냄 — 관리자가 f2만 강제 마감시킴
  handlers.f1['admin:forceFinish']('f2');

  const participants = latestParticipants();
  const f2 = participants.find((p) => p.id === 'f2');
  assert.strictEqual(f2.createDone, true, '강제 마감된 참가자는 createDone=true여야 함');
  assert.strictEqual(f2.weapon.parts.length, 0, '기본 무기는 빈 parts를 가져야 함');
  assert.strictEqual(f2.weapon.attackRange, 'melee', '기본 무기는 melee여야 함');
  assert.ok(f2.weapon.damage >= 1, '기본 무기도 유효한 damage 값을 가져야 함');

  const f3 = participants.find((p) => p.id === 'f3');
  assert.strictEqual(f3.createDone, false, '강제 마감하지 않은 참가자는 그대로 미완료여야 함');

  // 중복 강제 마감은 무시되어야 한다(이미 완료된 참가자에게 다시 호출).
  const beforeRepeat = countAdminParticipantsEmits();
  handlers.f1['admin:forceFinish']('f2');
  assert.strictEqual(countAdminParticipantsEmits(), beforeRepeat, '이미 완료된 참가자에게 다시 강제 마감을 호출하면 아무 일도 없어야 함');

  // 존재하지 않는(이미 연결 끊긴) 참가자에 대한 강제 마감도 무시되어야 한다.
  handlers.f1['admin:forceFinish']('ghost-id');
  assert.strictEqual(countAdminParticipantsEmits(), beforeRepeat, '존재하지 않는 참가자 id에 대한 강제 마감은 무시되어야 함');

  console.log('admin:forceFinish assigns a fixed fallback weapon and ignores already-done/unknown participants: OK');
}

// 회귀 테스트: 세션 시작 시점의 접속 인원이 목표가 되어야 한다(5명 고정 아님).
{
  handlers.f1['admin:reset']();
  for (let i = 1; i <= 3; i += 1) {
    handlers[`f${i}`]['disconnect']();
  }
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`t${i}`));
    handlers[`t${i}`]['participant:join']();
  }
  handlers.t1['admin:startSession']();
  // disconnect가 남긴 create:progress(total:0) 잡음은 여기서 걷어낸다 — 이 블록이
  // 확인하려는 건 "admin:startSession 이후" total이 3으로 고정되는지다.
  emitted.length = 0;
  handlers.t1['admin:nextStage'](); // -> learn
  handlers.t1['admin:nextStage'](); // -> create

  handlers.t1['create:done']({ damage: 100 });
  handlers.t2['create:done']({ damage: 100 });
  const progressEvents = emitted.filter(([ev]) => ev === 'create:progress').map(([, p]) => p);
  assert.ok(progressEvents.every((p) => p.total === 3), '3명 세션에서 total은 3이어야 함(5명 고정 아님)');
  console.log('session locks expected participant count to join-time headcount, not a fixed 5: OK');
}

// 회귀 테스트: admin:startSession이 목표 인원을 고정하는 즉시 create:progress로
// 브로드캐스트해야 한다.
{
  handlers.t1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    handlers[`t${i}`]['disconnect']();
  }
  registerSessionHandlers(io, makeSocket('w1'));
  handlers.w1['participant:join']();
  registerSessionHandlers(io, makeSocket('w2'));
  handlers.w2['participant:join']();
  registerSessionHandlers(io, makeSocket('w3'));
  handlers.w3['participant:join']();

  handlers.w1['admin:startSession']();

  const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)?.[1];
  assert.ok(latestProgress, 'admin:startSession 직후 create:progress가 브로드캐스트되어야 함');
  assert.strictEqual(latestProgress.total, 3, 'create:progress의 total이 방금 고정된 expectedParticipants와 즉시 일치해야 함');
  console.log('admin:startSession immediately broadcasts the newly locked expectedParticipants: OK');
}

// 회귀 테스트: admin:reset/admin:startSession으로 새 라운드가 시작되면 이전 라운드의
// 이름/제작 완료 상태가 남아있으면 안 된다(기기를 계속 켜두는 운영 방식 — 2026-08-07
// 설계 문서 배경 참고. 이게 없으면 다음 그룹 참가자가 이전 그룹 이름/완료 상태를 그대로
// 물려받는다).
{
  handlers.w1['admin:reset']();
  emitted.length = 0;
  handlers.w1['participant:name']('영희'); // 리셋 후에도 기기는 연결이 유지된 채임
  handlers.w1['admin:startSession'](); // 새 라운드 시작 — 이전 이름/완료 상태는 초기화되어야 함

  const participants = latestParticipants();
  const w1 = participants.find((p) => p.id === 'w1');
  assert.strictEqual(w1.name, null, '새 라운드가 시작되면 이전 라운드에 입력했던 이름은 초기화되어야 함');
  assert.strictEqual(w1.createDone, false, '새 라운드가 시작되면 제작 완료 상태도 초기화되어야 함');
  console.log("a new admin:startSession resets each surviving participant's round fields: OK");
}

stopBattleRoom();

console.log('session.createDone.test.mjs: all scenarios OK');
