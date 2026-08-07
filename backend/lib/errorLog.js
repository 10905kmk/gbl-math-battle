// 관리자 대시보드가 보여줄 최근 서버 에러 링버퍼 — 부스 운영 중 AI 평가 실패, 결과 저장
// 실패 등이 콘솔에만 찍히면 아무도 안 보고 있을 때 조용히 묻힌다. io는 서버 시작 시
// initErrorLog로 나중에 주입한다(errorLog.js 자체는 socket.io를 몰라도 되게).
const MAX_ENTRIES = 20;
let entries = []; // 최신이 앞
let ioRef = null;

export function initErrorLog(io) {
  ioRef = io;
}

export function logError(context, err) {
  console.error(`[${context}]`, err);
  const entry = {
    context,
    message: err instanceof Error ? err.message : String(err),
    timestamp: new Date().toISOString(),
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  ioRef?.emit('admin:error', entry);
}

export function getErrorLog() {
  return entries;
}
