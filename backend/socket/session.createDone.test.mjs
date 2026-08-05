import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  // registerSessionHandlers는 등록 시점에 socket.emit('stage:change', ...)을 바로 호출한다
  // (신규 접속 동기화 기능) — 목 소켓에도 emit이 있어야 한다.
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
// create:done 5명 완료는 이제 battle 단계까지 실제로 진입시키므로(session.js가
// startBattleRoom을 호출), io.to(id).emit(...)까지 흉내낼 수 있어야 한다 — 안 그러면
// 이 테스트가 끝난 뒤에도 계속 도는 20Hz 틱이 라운드 종료 시점에 "io.to is not a
// function"으로 죽는다(battleIntegration.test.mjs와 동일한 mock 패턴).
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: () => ({ emit: () => {} }),
};

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}

// 참가자 화면은 접속 시 participant:join을 보낸다 — admin:startSession 시점에 이 신호를
// 보낸 소켓 수가 이번 세션의 목표 인원(cohort.expectedParticipants)으로 고정된다.
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['participant:join']();
}

// create:done은 실제로는 create 화면이 떠 있을 때만(=stage가 'create'일 때만) 올 수 있다 —
// stage latch(아래 회귀 테스트)를 제대로 검증하려면 이 테스트도 실제 흐름처럼 먼저
// learn -> create로 진행시켜야 한다.
handlers.s1['admin:startSession'](); // -> learn (여기서 expectedParticipants = 5로 고정)
handlers.s1['admin:nextStage'](); // -> create

// 4명만 완료 — 아직 battle로 안 넘어가야 함
for (let i = 1; i <= 4; i += 1) {
  handlers[`s${i}`]['create:done']({ damage: 1000 * i });
}
assert.ok(!emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '4명만 완료 시 battle 전환 안 됨');

// 5번째 완료 — battle로 전환되어야 함
handlers['s5']['create:done']({ damage: 5000 });
assert.ok(emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '5명 전원 완료 시 battle 전환');

console.log('session.createDone.test.mjs: OK');

// 진행도(create:progress)가 완료 수만큼 정확히 브로드캐스트되는지 확인 (Opus 리뷰 Important #13 —
// 예전엔 클라이언트가 항상 하드코딩된 "0/5"만 보여줬다).
{
  const progressEvents = emitted.filter(([ev]) => ev === 'create:progress').map(([, p]) => p);
  assert.deepStrictEqual(
    progressEvents.map((p) => p.done),
    // 맨 앞의 0은 admin:startSession이 expectedParticipants를 고정하는 즉시 브로드캐스트하는
    // 초기값이다(Opus 리뷰 Important I1 — 이게 없으면 이미 접속해 있던 참가자 화면은 첫
    // create:done이 올 때까지 total이 옛 값에 머문다) — 그 뒤로 create:done마다 하나씩 늘어난다.
    [0, 1, 2, 3, 4, 5],
    'admin:startSession 직후 done:0 브로드캐스트 + create:done마다 done count가 하나씩 늘며 브로드캐스트되어야 함',
  );
  assert.ok(progressEvents.every((p) => p.total === 5));
  console.log('create:progress broadcasts accurate done count: OK');
}

// 회귀 테스트: 관리자가 이미 create를 벗어난 뒤(예: 강제로 다음 단계로 넘김) 뒤늦게 도착한
// create:done은 stage를 다시 battle로 되돌리면 안 된다 (Opus 리뷰 Critical #2a — 실제로
// "결과 화면까지 갔는데 느린 참가자의 뒤늦은 완료로 battle로 끌려가는" 시나리오로 재현됨).
{
  handlers.s1['admin:nextStage'](); // battle -> result
  const stageChangesBeforeStrayDone = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(stageChangesBeforeStrayDone, ['learn', 'create', 'battle', 'result']);

  // 이미 result인 상태에서 뒤늦게 create:done이 또 온 경우(느린 참가자의 지연된 요청 등)
  handlers.s1['create:done']({ damage: 9999 });

  const stageChangesAfterStrayDone = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(
    stageChangesAfterStrayDone,
    ['learn', 'create', 'battle', 'result'],
    'result 단계에서 뒤늦은 create:done이 battle로 되돌리면 안 됨',
  );
  console.log('late create:done after leaving create stage does not drag the cohort backward: OK');
}

// 회귀 테스트: 참가자가 새로고침해서 소켓이 바뀌어도(옛 소켓 disconnect + 새 소켓으로 재등록)
// 중복으로 카운트되면 안 된다 (Opus 리뷰 Critical #2b — 실제로 한 참가자가 5번 새로고침해도
// cohort가 battle로 조기 전환되는 것으로 재현됨).
{
  handlers.s1['admin:reset']();
  emitted.length = 0; // 이전 시나리오의 이벤트는 이 검증과 무관하니 비움
  // 계획 수정(구현 중 발견): joined Set은 admin:reset으로도 비워지지 않으므로(설계 의도대로 —
  // 참가자 기기가 그대로 접속돼 있다고 가정), 이전 시나리오의 s1~s5가 실제로는 퇴장하지 않은
  // 채 그대로 남아있으면 이 블록의 expectedParticipants가 5가 아니라 10(s1~s5+r1~r5)으로
  // 부풀려진다. 이 테스트는 "완전히 새로운 5명 세션"을 검증하려는 것이므로, 이전 참가자들의
  // 기기가 실제로 연결을 끊었다고 명시적으로 흉내낸다.
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
  handlers.r1['admin:nextStage'](); // -> create

  // r1이 새로고침을 4번 반복한다고 가정: 매번 disconnect 후 새 소켓으로 재등록 + 재완료.
  // disconnect 정리가 제대로 안 되면 매 refresh마다 참가자 수가 계속 쌓여서, 여기 4번의
  // refresh만으로도 done count가 4까지 올라가버린다 — 그래서 매 반복 직후 done이 항상
  // 1에 머무는지(=이전 refresh의 유령이 안 남는지) 직접 확인한다.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const refreshedId = `r1-refresh${attempt}`;
    handlers.r1['disconnect'](); // 옛 소켓 정리
    registerSessionHandlers(io, makeSocket(refreshedId));
    handlers[refreshedId]['create:done']({ damage: 100 });
    handlers.r1 = handlers[refreshedId]; // 다음 반복에서 "현재 r1 소켓"으로 취급

    const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)[1];
    assert.strictEqual(
      latestProgress.done,
      1,
      `refresh ${attempt}회차 이후에도 완료 인원은 1명(r1 본인)이어야 함 — 유령 참가자가 쌓이면 안 됨`,
    );
  }

  // r2~r5는 정상적으로 한 번씩만 완료 — 이 4명이 다 채워져야 비로소 5명(r1+r2~r5)이 된다.
  for (let i = 2; i <= 5; i += 1) {
    handlers[`r${i}`]['create:done']({ damage: 100 });
  }

  const stageChangesAfterRefreshes = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(
    stageChangesAfterRefreshes,
    ['learn', 'create', 'battle'],
    '참가자 1명이 4번 새로고침해도 실제 완료 인원은 5명(새로고침한 1명 + 4명)이어야 battle로 전환됨',
  );
  console.log('refresh churn does not double-count participants: OK');
}

// 마지막 시나리오가 battle 단계로 끝나서 20Hz 틱(setInterval)이 계속 돌고 있다 — 정리 안 하면
// 이 프로세스가 안 끝나거나(setInterval이 이벤트 루프를 붙잡음), 90초 뒤 라운드가 타임아웃으로
// 끝나는 시점에 가서야 문제가 드러난다. 테스트 스크립트답게 명시적으로 정지시킨다.
// 회귀 테스트: 5명 고정이 아니라 "세션 시작 시점에 접속해 있던 인원"이 목표가 되어야 한다 —
// 3명만 참가했다면 3명 완료로 battle 전환돼야 한다(예전처럼 5명을 기다리며 멈춰있으면 안 됨).
{
  handlers.r1['admin:reset']();
  emitted.length = 0;
  // 계획 수정(구현 중 발견): 위 refresh 시나리오와 동일한 이유로, r2~r5(및 마지막으로 살아있는
  // r1의 refresh4 소켓)를 명시적으로 disconnect시켜 joined Set에서 빼지 않으면 이 3명짜리
  // 세션의 expectedParticipants가 3이 아니라 훨씬 큰 값으로 부풀려진다.
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['disconnect']();
  }
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`t${i}`));
    handlers[`t${i}`]['participant:join']();
  }
  handlers.t1['admin:startSession']();
  handlers.t1['admin:nextStage'](); // -> create

  handlers.t1['create:done']({ damage: 100 });
  handlers.t2['create:done']({ damage: 100 });
  assert.ok(
    !emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'),
    '3명 세션에서 2명만 완료 시 아직 battle 전환 안 됨',
  );

  handlers.t3['create:done']({ damage: 100 });
  assert.ok(
    emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'),
    '3명 세션은 3명만 완료해도 battle로 전환되어야 함(5명 고정이 아님)',
  );
  console.log('session locks expected participant count to join-time headcount, not a fixed 5: OK');
}

// 회귀 테스트: expectedParticipants가 0으로 고정된 세션(admin:startSession 시점에 아무도 접속
// 안 했던 경우 — 예: 관리자가 먼저 세션 시작을 누르고 그 뒤에 참가자들에게 태블릿을 나눠주는
// 순서)에서, 뒤늦게 접속한 참가자의 첫 create:done만으로 battle 전환되면 안 된다
// (Opus 리뷰 Critical C1 — doneCount() 1 >= expectedParticipants 0 이 참으로 평가되어 1명짜리
// battle room이 열리고 alivePlayers<=1 승리 조건으로 그대로 종료돼버리는 버그가 실제로 재현됨).
{
  handlers.t3['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    handlers[`t${i}`]['disconnect']();
  }
  // 관리자 화면 소켓은 participant:join을 보내지 않는다 — 아무도 접속하지 않은 상태에서
  // 세션 시작을 누른 상황을 재현.
  registerSessionHandlers(io, makeSocket('z0'));
  handlers.z0['admin:startSession'](); // -> learn, expectedParticipants = 0
  handlers.z0['admin:nextStage'](); // -> create

  registerSessionHandlers(io, makeSocket('z1'));
  handlers.z1['participant:join']();
  registerSessionHandlers(io, makeSocket('z2'));
  handlers.z2['participant:join']();
  registerSessionHandlers(io, makeSocket('z3'));
  handlers.z3['participant:join']();

  handlers.z1['create:done']({ damage: 100 });
  assert.ok(
    !emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'),
    'expectedParticipants가 0으로 고정된 상태에서는 첫 완료자만으로 battle 전환되면 안 됨',
  );
  console.log('zero expectedParticipants does not trigger battle on the first create:done: OK');
}

// 회귀 테스트: admin:startSession이 expectedParticipants를 고정하는 즉시 그 값을
// create:progress로 브로드캐스트해야 한다 — 안 그러면 이미 접속해 있던 참가자 화면은 첫
// create:done이 도착할 때까지 total이 옛 값(0 또는 지난 세션 값)에 머물러 "0/0" 같은 잘못된
// 진행률을 잠깐 보여준다 (Opus 리뷰 Important I1 / Minor M1).
{
  handlers.z0['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    handlers[`z${i}`]['disconnect']();
  }
  registerSessionHandlers(io, makeSocket('w1'));
  handlers.w1['participant:join']();
  registerSessionHandlers(io, makeSocket('w2'));
  handlers.w2['participant:join']();
  registerSessionHandlers(io, makeSocket('w3'));
  handlers.w3['participant:join']();

  handlers.w1['admin:startSession'](); // -> learn, expectedParticipants = 3으로 고정

  const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)?.[1];
  assert.ok(latestProgress, 'admin:startSession 직후 create:progress가 브로드캐스트되어야 함');
  assert.strictEqual(
    latestProgress.total,
    3,
    'create:progress의 total이 방금 고정된 expectedParticipants와 즉시 일치해야 함',
  );
  console.log('admin:startSession immediately broadcasts the newly locked expectedParticipants: OK');
}

stopBattleRoom();

console.log('session.createDone.test.mjs: all scenarios OK');
