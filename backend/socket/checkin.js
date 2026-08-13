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
  ioRef?.emit('checkin:list', checkinList);
}

export function removeByDeviceId(deviceId) {
  const before = checkinList.length;
  const remaining = checkinList.filter((entry) => entry.deviceId !== deviceId);
  if (remaining.length === before) return false;
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return true;
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
  socket.emit('checkin:list', checkinList);

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

  socket.on('admin:resetParticipant', (participantId) => {
    if (resetParticipant(ioRef, participantId)) {
      removeByDeviceId(participantId);
    }
  });

  // 새로고침 없이 완전히 연결이 끊긴 기기(부스를 그냥 나가버린 경우)는 체크인 목록에서도
  // 같이 정리해야 한다 — 안 그러면 게임 종료 시 소진 등록에 유령 uid가 섞여 들어간다.
  socket.on('disconnect', () => {
    removeByDeviceId(socket.id);
  });
}

// 관리자가 "체크인 목록 소진" 버튼을 누르면 호출된다(routes/checkin.js). 허브 쪽 부하를
// 피하려고 병렬이 아니라 순차로 호출한다. 실패한 항목은 목록에 남겨 재시도할 수 있게 한다.
export async function consumeCheckinList() {
  const results = [];
  const remaining = [];
  for (const entry of checkinList) {
    const outcome = await addUser(entry.uid);
    if (outcome.ok) {
      results.push({ uid: entry.uid, name: entry.name, status: 'ok' });
    } else {
      results.push({ uid: entry.uid, name: entry.name, status: 'error', message: outcome.message });
      remaining.push(entry);
    }
  }
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return results;
}

// 테스트 전용 — 모듈 싱글턴 목록을 초기화한다.
export function _resetForTest() {
  checkinList.length = 0;
}
