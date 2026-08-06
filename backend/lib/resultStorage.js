import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveResult } from './supabaseClient.js';
import { computeRanks } from './battleSimulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FALLBACK_PATH = path.join(__dirname, '../data/results-fallback.jsonl');

// 대전 종료 시 참가자별 결과를 저장한다. 저장 실패는 절대 호출자를 막지 않도록
// 각 저장을 개별적으로 try/catch로 감싼다 — 부스 운영 중엔 저장 실패보다 stage 전환이
// 막히는 쪽이 더 나쁘다.
//
// 참가자 수만큼(Promise.all로) 동시에 쏘지 않고 한 명씩 순서대로 await한다 — 처음엔
// Promise.all로 동시에 쐈는데, 실제 부스 규모(최대 5~8명)에서는 지연이 무시할 만한
// 수준(수백 ms)인 반면, 같은 Supabase 클라이언트 인스턴스로 여러 요청을 동시에 쏘면
// 드물게 "JWT issued at future"(PGRST303) 오류가 한쪽에서만 나는 현상이 실제로
// 관측됐다(같은 순간에 만든 요청 중 하나만 실패, 나머지는 성공) — 클라이언트 라이브러리
// 내부의 인증 처리가 동시 요청에 완전히 안전하지 않을 가능성이 있어, 굳이 병렬화해서
// 얻는 이득보다 이 리스크를 피하는 쪽을 택한다.
//
// winners는 배열이 아닌 값(undefined 등)이 들어와도 여기서 막아야 한다 — 이 함수는 호출자가
// await 없이 fire-and-forget으로 호출하므로(session.js), map() 콜백 안에서 던지는 예외는
// Promise.allSettled가 절대 잡아주지 못하고 그대로 unhandled rejection이 되어 서버가 죽는다.
// scores도 같은 이유로 방어한다 — { [participantId]: number } 형태가 아니면 각 참가자의
// score를 null로 남긴다.
export async function saveParticipantResults(participants, winners, scores, saveFn = saveResult, fallbackPath = DEFAULT_FALLBACK_PATH) {
  const winnerIds = Array.isArray(winners) ? winners : [];
  const safeScores = scores && typeof scores === 'object' ? scores : {};
  // computeRanks는 { [id]: score } 형태만 받으므로 undefined/NaN 참가자는 미리 걸러내고
  // 계산한 뒤, 랭크가 없는(걸러진) 참가자는 저장 시점에 null로 남긴다 — battle:result가
  // 이미 같은 데이터로 참가자 화면에 보낸 등수와 어긋나지 않아야 한다(battle.js와 이
  // 함수가 각자 computeRanks를 호출하는 이유 — battleSimulation.js의 computeRanks 주석 참고).
  const rankableScores = {};
  for (const p of participants) {
    if (Number.isFinite(safeScores[p.id])) rankableScores[p.id] = safeScores[p.id];
  }
  const ranks = computeRanks(rankableScores);
  const payloads = participants.map((p) => ({
    weapon_name: p.weapon?.name,
    weapon_image: p.weapon?.image,
    weapon_damage: p.weapon?.damage,
    win: winnerIds.includes(p.id),
    score: Number.isFinite(safeScores[p.id]) ? safeScores[p.id] : null,
    rank: ranks[p.id] ?? null,
  }));

  // Promise.allSettled와 같은 모양({status, value|reason}[], payloads와 같은 순서)을
  // 손수 만든다 — 호출자(session.js)가 인덱스로 참가자와 짝짓는 방식은 그대로 재사용.
  const outcomes = [];
  for (const payload of payloads) {
    try {
      const value = await saveFn(payload);
      outcomes.push({ status: 'fulfilled', value });
    } catch (reason) {
      outcomes.push({ status: 'rejected', reason });
    }
  }

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
