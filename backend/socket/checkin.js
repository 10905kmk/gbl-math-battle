// 부스 QR 체크인 — 관리자가 checkin.html에서 스캔한 참가자를 빈 게임 기기에 배정하고,
// 기기↔uid 매핑을 들고 있다가 게임 종료 시 허브에 일괄 등록한다(routes/checkin.js의
// consumeCheckinList 호출부).
//
// cohort.participants는 session.js가 소유한다 — 이 모듈은 findUnassignedParticipant/
// assignParticipantName/resetParticipant 세 헬퍼로만 접근해서 cohort 내부 구조를 몰라도
// 되게 한다.
import { findUnassignedParticipant, assignParticipantName, resetParticipant } from './session.js';
import { addUser } from '../lib/boothApi.js';

// io는 서버 시작 시 initCheckinIo로 나중에 주입한다(errorLog.js와 같은 패턴) —
// REST 라우트(routes/checkin.js)의 consumeCheckinList는 소켓 연결 없이 브로드캐스트가
// 필요하기 때문에, 매 소켓 이벤트마다 io를 넘겨받는 대신 모듈이 직접 들고 있는다.
let ioRef = null;

// { deviceId, uid, name, profile_image, assignedAt }[]
export const checkinList = [];

export function initCheckinIo(io) {
  ioRef = io;
}

function broadcastList() {
  ioRef?.to('checkin-admin').emit('checkin:list', checkinList);
}

function removeByUid(uid) {
  const before = checkinList.length;
  const remaining = checkinList.filter((entry) => entry.uid !== uid);
  if (remaining.length === before) return false;
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return true;
}

export function registerCheckinHandlers(socket) {
  // checkin:list는 실명/외부 허브 uid/프로필 이미지를 담고 있어 admin:participants보다
  // 민감하다 — 이걸 필요로 하는 두 관리자 화면(checkin.js, admin.js)만 구독하도록, 연결
  // 즉시 전체 브로드캐스트하는 대신 명시적으로 구독을 요청한 소켓에만 보낸다.
  socket.on('checkin:subscribe', () => {
    socket.join('checkin-admin');
    socket.emit('checkin:list', checkinList);
  });

  socket.on('checkin:confirmAssign', ({ uid, name, profile_image } = {}, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (checkinList.some((entry) => entry.uid === uid)) {
      respond({ ok: false, reason: 'already_checked_in' });
      return;
    }
    const device = findUnassignedParticipant();
    if (!device) {
      respond({ ok: false, reason: 'no_device' });
      return;
    }
    assignParticipantName(ioRef, device.id, name);
    // 참가자 화면(NameScreen)이 입력 필드를 미리 채우도록, 배정된 기기에만 원본
    // (트림/길이 제한 전) 이름을 그대로 전달한다 — 참가자가 그대로 제출하거나 수정한다.
    ioRef?.to(device.id).emit('name:prefill', name);
    checkinList.push({ deviceId: device.id, uid, name, profile_image, assignedAt: Date.now() });
    broadcastList();
    respond({ ok: true });
  });

  socket.on('checkin:unlink', (uid) => {
    removeByUid(uid);
  });

  // checkinList 항목은 "이 사람이 부스를 방문했다"는 방문 기록이다 — 기기 초기화(재사용을
  // 위해 staff가 세션만 리셋하는 것)만으로는 그 방문 사실이 사라지지 않는다. resetParticipant는
  // session.js가 소유한 이름/스킬 등 세션 상태만 되돌리고, checkinList는 건드리지 않는다.
  socket.on('admin:resetParticipant', (participantId) => {
    resetParticipant(ioRef, participantId);
  });

  // 의도적으로 여기엔 'disconnect' 핸들러가 없다 — 소켓 연결이 끊기는 것(와이파이 순단
  // 등으로 인한 재연결 포함)은 방문 사실을 취소할 이유가 되지 않는다. checkinList의
  // deviceId는 체크인 당시 어느 기기였는지 보여주는 참고 정보로만 남는다. 이 항목을
  // 지우는 유일한 경로는 명시적인 checkin:unlink(staff가 "연결 해제"를 누른 경우)와
  // consumeCheckinList의 성공 등록 처리뿐이다.
}

// 관리자가 "체크인 목록 소진" 버튼을 누르면 호출된다(routes/checkin.js). 허브 쪽 부하를
// 피하려고 병렬이 아니라 순차로 호출한다. 실패한 항목은 목록에 남겨 재시도할 수 있게 한다.
export async function consumeCheckinList() {
  // checkinList를 그대로 순회하면서 매번 await하면, 그 사이 다른 소켓 이벤트(confirmAssign/
  // unlink) 또는 consumeCheckinList의 동시 호출이 checkinList를 갈아끼울 수 있어 순회 중인 배열과
  // 실제 배열이 어긋난다. 순회는 시작 시점 스냅샷(batch)으로 하고, 끝에서는 그 스냅샷으로
  // 통째로 덮어쓰는 대신 "성공한 uid만" 현재 시점의 checkinList에서 제거한다 — 그래야 소진
  // 도중에 새로 추가된 항목은 살아남고, 도중에 지워진 항목이 되살아나지 않는다.
  const batch = [...checkinList];
  const results = [];
  const succeededUids = new Set();
  for (const entry of batch) {
    const outcome = await addUser(entry.uid);
    if (outcome.ok) {
      results.push({ uid: entry.uid, name: entry.name, status: 'ok' });
      succeededUids.add(entry.uid);
    } else {
      results.push({ uid: entry.uid, name: entry.name, status: 'error', message: outcome.message });
    }
  }
  const surviving = checkinList.filter((entry) => !succeededUids.has(entry.uid));
  checkinList.length = 0;
  checkinList.push(...surviving);
  broadcastList();
  return results;
}

// 테스트 전용 — 모듈 싱글턴 목록을 초기화한다.
export function _resetForTest() {
  checkinList.length = 0;
}
