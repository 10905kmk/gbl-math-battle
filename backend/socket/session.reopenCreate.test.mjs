// admin:reopenCreate — 실수로 "AI 평가받기"를 눌러 확정돼버린 참가자를 관리자가 편집
// 화면으로 되돌린다.
//
// session.js의 cohort는 모듈 싱글턴이라 한 파일 안에서 stage를 이리저리 옮기면 뒤 블록이
// 앞 블록의 stage에 끌려다닌다(실제로 createDone 테스트 안에 넣었다가 그 지점이 이미
// battle 단계라 가드에 막혔다) — stage 조건이 핵심인 이 기능은 별도 파일에서 검증한다.
// node --test는 파일마다 별도 프로세스라 cohort가 깨끗한 상태로 시작한다.
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';

const handlers = {};
function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => {
      handlers[id] = handlers[id] || {};
      handlers[id][ev] = fn;
    },
    emit: () => {},
  };
}

const emitted = [];
// io.to(id).emit(...)까지 기록해야 "그 참가자에게만" 갔는지 확인할 수 있다.
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: (ev, payload) => targeted.push([id, ev, payload]) }),
};

const latestParticipants = () => emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
const latestProgress = () => emitted.filter(([ev]) => ev === 'create:progress').at(-1)?.[1];
const participantEmitCount = () => emitted.filter(([ev]) => ev === 'admin:participants').length;
const entryOf = (id) => latestParticipants().find((p) => p.id === id);

for (const id of ['s1', 's2']) registerSessionHandlers(io, makeSocket(id));
for (const id of ['s1', 's2']) handlers[id]['participant:join']();

handlers.s1['admin:startSession'](); // -> name
handlers.s1['admin:nextStage'](); // -> learn
handlers.s1['admin:nextStage'](); // -> create

handlers.s1['create:done']({ damage: 4200, name: '실수로 확정한 창' });
handlers.s2['create:done']({ damage: 3100, name: '멀쩡한 방패' });
assert.strictEqual(latestProgress().done, 2);

// 되돌리기 성공 경로
{
  handlers.s1['admin:reopenCreate']('s1');

  const s1 = entryOf('s1');
  assert.strictEqual(s1.createDone, false, '되돌린 참가자는 미완료 상태여야 함');
  assert.strictEqual(s1.weapon, null, '되돌리면 평가받은 무기는 지워져야 함');
  assert.strictEqual(entryOf('s2').createDone, true, '다른 참가자는 영향을 받으면 안 됨');
  assert.strictEqual(latestProgress().done, 1, '되돌린 만큼 완료 인원이 줄어야 함');

  const reopens = targeted.filter(([, ev]) => ev === 'create:reopen');
  assert.deepStrictEqual(
    reopens.map(([id]) => id),
    ['s1'],
    'create:reopen은 되돌린 참가자에게만 가야 함',
  );
  console.log('admin:reopenCreate reopens only the targeted participant: OK');
}

// 무효한 호출은 조용히 무시 — 브로드캐스트도 하지 않는다.
{
  const before = participantEmitCount();
  handlers.s1['admin:reopenCreate']('존재하지-않는-id');
  handlers.s1['admin:reopenCreate']('s1'); // 이미 미완료
  handlers.s1['admin:reopenCreate'](undefined);
  assert.strictEqual(participantEmitCount(), before, '무효한 되돌리기는 브로드캐스트하지 않아야 함');
  console.log('admin:reopenCreate ignores unknown/already-editing participants: OK');
}

// create 단계가 아니면 막힌다 — battle로 넘어간 뒤엔 이미 대전 시작 시점의 참가자
// 스냅샷이 떠 있어서, 여기서 무기를 지워봐야 진행 중인 대전에는 반영되지 않는다.
{
  handlers.s1['create:done']({ damage: 4200, name: '다시 만든 창' });
  assert.strictEqual(entryOf('s1').createDone, true);

  // battle을 실제로 시작시키지 않고 stage만 result로 옮겨서 가드만 검증한다 — 대전을
  // 띄우면 종료 콜백이 Supabase 저장까지 타고 들어가 이 단위 테스트가 네트워크에 묶인다.
  handlers.s1['admin:reset']();
  handlers.s1['admin:startSession'](); // -> name (createDone 초기화됨)
  handlers.s1['create:done']({ damage: 4200, name: 'name 단계에서 확정' });
  handlers.s1['admin:reopenCreate']('s1');
  assert.strictEqual(entryOf('s1').createDone, true, 'create 단계가 아니면 되돌리기가 무시되어야 함');
  console.log('admin:reopenCreate is rejected outside the create stage: OK');
}

console.log('session.reopenCreate.test.mjs: all scenarios OK');
