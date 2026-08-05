import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveResult } from './supabaseClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FALLBACK_PATH = path.join(__dirname, '../data/results-fallback.jsonl');

// 대전 종료 시 참가자별 결과를 저장한다. 저장 실패는 절대 호출자를 막지 않도록
// Promise.allSettled로 감싼다 — 부스 운영 중엔 저장 실패보다 stage 전환이 막히는 쪽이 더 나쁘다.
//
// winners는 배열이 아닌 값(undefined 등)이 들어와도 여기서 막아야 한다 — 이 함수는 호출자가
// await 없이 fire-and-forget으로 호출하므로(session.js), map() 콜백 안에서 던지는 예외는
// Promise.allSettled가 절대 잡아주지 못하고 그대로 unhandled rejection이 되어 서버가 죽는다.
// scores도 같은 이유로 방어한다 — { [participantId]: number } 형태가 아니면 각 참가자의
// score를 null로 남긴다.
export async function saveParticipantResults(participants, winners, scores, saveFn = saveResult, fallbackPath = DEFAULT_FALLBACK_PATH) {
  const winnerIds = Array.isArray(winners) ? winners : [];
  const safeScores = scores && typeof scores === 'object' ? scores : {};
  const payloads = participants.map((p) => ({
    weapon_name: p.weapon?.name,
    weapon_image: p.weapon?.image,
    weapon_stats: p.weapon?.stats,
    weapon_damage: p.weapon?.damage,
    win: winnerIds.includes(p.id),
    score: Number.isFinite(safeScores[p.id]) ? safeScores[p.id] : null,
  }));

  const outcomes = await Promise.allSettled(payloads.map((payload) => saveFn(payload)));

  const failedPayloads = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.error('[resultStorage] 참가자 결과 저장 실패:', participants[i].id, outcome.reason);
      failedPayloads.push(payloads[i]);
    }
  });

  // Supabase 저장이 실패해도 결과 자체를 완전히 잃어버리진 않도록 로컬 파일에 남긴다 —
  // 콘솔 로그만으로는 부스 운영 중 아무도 안 보고 있으면 그날 저장이 전부 유실된 걸
  // 행사가 끝난 뒤에야 알게 된다.
  if (failedPayloads.length > 0) {
    await appendFallback(failedPayloads, fallbackPath);
  }

  return outcomes;
}

async function appendFallback(payloads, fallbackPath) {
  try {
    await mkdir(path.dirname(fallbackPath), { recursive: true });
    const lines = payloads
      .map((payload) => JSON.stringify({ ...payload, failed_at: new Date().toISOString() }))
      .join('\n') + '\n';
    await appendFile(fallbackPath, lines, 'utf8');
  } catch (err) {
    console.error('[resultStorage] fallback 파일 기록도 실패:', err);
  }
}
