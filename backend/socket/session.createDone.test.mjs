import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';

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
const io = { emit: (ev, payload) => emitted.push([ev, payload]) };

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}

// create:done은 실제로는 create 화면이 떠 있을 때만(=stage가 'create'일 때만) 올 수 있다 —
// stage latch(아래 회귀 테스트)를 제대로 검증하려면 이 테스트도 실제 흐름처럼 먼저
// learn -> create로 진행시켜야 한다.
handlers.s1['admin:startSession'](); // -> learn
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
    [1, 2, 3, 4, 5],
    'create:done이 올 때마다 done count가 하나씩 늘며 브로드캐스트되어야 함',
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
  for (let i = 1; i <= 5; i += 1) {
    registerSessionHandlers(io, makeSocket(`r${i}`));
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

console.log('session.createDone.test.mjs: all scenarios OK');
