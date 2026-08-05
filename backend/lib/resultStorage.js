import { saveResult } from './supabaseClient.js';

// 대전 종료 시 참가자별 결과를 저장한다. 저장 실패는 절대 호출자를 막지 않도록
// Promise.allSettled로 감싼다 — 부스 운영 중엔 저장 실패보다 stage 전환이 막히는 쪽이 더 나쁘다.
export async function saveParticipantResults(participants, winners, saveFn = saveResult) {
  const outcomes = await Promise.allSettled(
    participants.map((p) => saveFn({
      weapon_name: p.weapon?.name,
      weapon_image: p.weapon?.image,
      weapon_stats: p.weapon?.stats,
      weapon_damage: p.weapon?.damage,
      win: winners.includes(p.id),
    })),
  );
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.error('[resultStorage] 참가자 결과 저장 실패:', participants[i].id, outcome.reason);
    }
  });
  return outcomes;
}
