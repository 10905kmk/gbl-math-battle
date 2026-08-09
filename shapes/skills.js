// 특수 스킬 정의 — 프론트(룰렛/버튼/파티클)와 백엔드(효과 판정)가 그대로 공유한다.
//
// 스킬 선정 기준(2026-08-09): 제안받은 27개 중 서로 "다른 축"을 담당하는 것만 남겼다.
// 중복이 많은 조합은 룰렛으로 3개를 뽑아도 셋 다 비슷해 보여서 고르는 재미가 사라진다.
//   - 뺀 것: 분신(가짜 엔티티 렌더/AI가 다른 스킬 전부보다 비쌈), 교환(연행영장과 겹침,
//     낙사 지형이 없는 맵이라 재미 반감), 갈고리(순간이동+연행영장 합본), 역장(개인전이라
//     '아군' 개념이 없음 + 실드와 겹침), 구급키트(힐의 변형), 중력반전(콜드플레이/시간정지와
//     CC 중복), 잔상(속도증가와 중복).
//
// 거리 단위: 기획서의 "m"는 캐릭터 반지름 20px 기준 1m ≈ 40px로 환산했다(캐릭터 지름 =
// 대략 1m로 보는 관례). 4m ≈ 160px, 5m ≈ 200px, 7m ≈ 280px.
export const METER = 40;

// kind: 서버가 어떻게 처리하는지에 대한 분류.
//   'self'   — 자기 자신에게 즉시 효과
//   'aura'   — 자기 중심 원형 범위의 적에게 효과
//   'cone'   — 자기 앞 부채꼴에서 대상 1명 선택
//   'place'  — 월드에 무언가를 설치/생성
//   'shot'   — 투사체를 하나 발사
//   'toggle' — 두 번 눌러 완성되는 스킬(텔레포트 백)
//   'passive'— 버튼이 없고 조건이 되면 저절로 발동
export const SKILLS = [
  // ── 회복/방어 ──────────────────────────────────────────────────────
  {
    id: 'heal', name: '힐', icon: '✚', kind: 'self', cooldownMs: 40000,
    desc: 'HP를 30% 회복합니다.',
    healPercent: 30, color: '#5fe3a1',
  },
  {
    id: 'shield', name: '실드', icon: '🛡', kind: 'self', cooldownMs: 35000,
    desc: '5초 동안 모든 피해를 받지 않습니다.',
    durationMs: 5000, color: '#a98bff',
  },
  {
    id: 'reflect', name: '반사', icon: '🔯', kind: 'self', cooldownMs: 40000,
    desc: '3초 동안 받은 피해의 50%를 공격자에게 돌려줍니다. (자신도 피해는 받습니다)',
    durationMs: 3000, reflectRatio: 0.5, color: '#c08bff',
  },

  // ── 이동 ───────────────────────────────────────────────────────────
  {
    id: 'speedUp', name: '속도증가', icon: '⚡', kind: 'self', cooldownMs: 40000,
    desc: '20초 동안 이동 속도가 2배가 됩니다.',
    durationMs: 20000, speedMultiplier: 2, color: '#5fe3a1',
  },
  {
    id: 'dash', name: '대쉬', icon: '💨', kind: 'self', cooldownMs: 20000,
    desc: '바라보는 방향으로 7m 순간 돌진합니다. 돌진 중 0.5초 무적.',
    distance: 7 * METER, invulnMs: 500, color: '#7cc4ff',
  },
  {
    id: 'blink', name: '순간이동', icon: '🔮', kind: 'shot', cooldownMs: 40000,
    desc: '하얀 진주를 던져 벽에 닿은 자리로 순간이동합니다.',
    projectileSpeed: 26, maxRange: 12 * METER, color: '#ffffff',
  },
  {
    id: 'recall', name: '텔레포트 백', icon: '⏪', kind: 'toggle', cooldownMs: 40000,
    desc: '누른 자리를 저장하고, 5초 안에 다시 누르면 그 자리로 돌아갑니다.',
    windowMs: 5000, color: '#7cc4ff',
  },

  // ── 군중 제어 ──────────────────────────────────────────────────────
  {
    id: 'slowHell', name: '속도지옥', icon: '🕸', kind: 'aura', cooldownMs: 60000,
    desc: '반경 5m 안의 적을 8초 동안 2.5배 느리게 만듭니다.',
    radius: 5 * METER, durationMs: 8000, slowFactor: 2.5, color: '#8fd3ff',
  },
  {
    id: 'timeStop', name: '시간정지', icon: '⏱', kind: 'aura', cooldownMs: 60000,
    desc: '반경 5m 안의 모든 적을 1.5초 동안 정지시킵니다.',
    radius: 5 * METER, durationMs: 1500, freeze: true, color: '#d5dbe6',
  },
  {
    id: 'shockwave', name: '충격파', icon: '💥', kind: 'aura', cooldownMs: 35000,
    desc: '반경 5m 안의 적을 강하게 밀쳐내고 5% 피해를 줍니다.',
    radius: 5 * METER, knockback: 4 * METER, damagePercent: 5, color: '#ffffff',
  },
  {
    id: 'blackhole', name: '블랙홀', icon: '🕳', kind: 'place', cooldownMs: 45000,
    desc: '바라보는 곳에 검은 구체를 만들어 반경 4m 안의 적을 2초간 끌어당깁니다.',
    radius: 4 * METER, durationMs: 2000, pullPerTick: 5, placeDistance: 3 * METER, color: '#a98bff',
  },
  {
    id: 'warrant', name: '연행영장', icon: '🚔', kind: 'cone', cooldownMs: 25000,
    desc: '앞쪽 부채꼴의 적 한 명을 자신 앞으로 끌고 옵니다.',
    range: 8 * METER, halfAngle: Math.PI / 5, color: '#ffa94d',
  },
  {
    id: 'coldplay', name: '콜드플레이', icon: '🧊', kind: 'cone', cooldownMs: 40000,
    desc: '앞쪽 부채꼴의 적 한 명에게 5% 피해를 주고 3초 동안 얼립니다.',
    range: 8 * METER, halfAngle: Math.PI / 6, damagePercent: 5, freezeMs: 3000, color: '#8fd3ff',
  },

  // ── 공격 강화 ──────────────────────────────────────────────────────
  {
    id: 'berserk', name: '광전사', icon: '🔥', kind: 'self', cooldownMs: 45000,
    desc: '7초 동안 공격력 1.3배, 대신 받는 피해도 1.25배가 됩니다.',
    durationMs: 7000, damageOut: 1.3, damageIn: 1.25, color: '#ff6b6b',
  },
  {
    id: 'poison', name: '독', icon: '☠', kind: 'self', cooldownMs: 35000,
    desc: '다음 공격 1회를 강화합니다. 명중하면 5초 동안 초당 1% 추가 피해.',
    armWindowMs: 10000, dotMs: 5000, dotPercentPerSec: 1, color: '#7ddc6a',
  },
  {
    id: 'deathMark', name: '사형선고', icon: '🎯', kind: 'cone', cooldownMs: 40000,
    desc: '앞쪽의 적 한 명에게 5초 동안 표식을 남깁니다. 그동안 그 적에게 주는 피해 20% 증가.',
    range: 9 * METER, halfAngle: Math.PI / 5, durationMs: 5000, damageBonus: 1.2, color: '#ff6b6b',
  },

  // ── 설치/은신 ──────────────────────────────────────────────────────
  {
    id: 'mine', name: '지뢰', icon: '💣', kind: 'place', cooldownMs: 35000,
    desc: '발밑에 지뢰를 설치합니다. 적이 1.5m 안에 들어오면 폭발해 10% 피해.',
    triggerRadius: 1.5 * METER, damagePercent: 10, knockback: 1.5 * METER, color: '#ff6b6b',
  },
  {
    id: 'cloak', name: '투명망토', icon: '👻', kind: 'self', cooldownMs: 40000,
    desc: '10초 동안 투명해지고 무적이 됩니다.',
    durationMs: 10000, color: '#d5dbe6',
  },

  // ── 패시브 ─────────────────────────────────────────────────────────
  {
    id: 'lucky', name: '운빨', icon: '🍀', kind: 'passive', cooldownMs: 0,
    desc: '공격할 때마다 10% 확률로 피해가 1.5배가 됩니다. (자동 발동)',
    chance: 0.1, multiplier: 1.5, color: '#ff6b6b',
  },
  {
    id: 'lastStand', name: '최후의 발악', icon: '🩸', kind: 'passive', cooldownMs: 50000,
    desc: 'HP가 20% 이하가 되면 5초 동안 이동 속도 1.5배, 공격력 1.2배. (자동 발동)',
    threshold: 0.2, durationMs: 5000, speedMultiplier: 1.5, damageOut: 1.2, color: '#ff6b6b',
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function getSkill(skillId) {
  return SKILL_BY_ID[skillId] ?? null;
}

export function isValidSkillId(skillId) {
  return Boolean(SKILL_BY_ID[skillId]);
}

// 룰렛 3개에 서로 다른 스킬을 하나씩 채운다 — 같은 스킬이 두 칸에 나오면 "3개 중 선택"의
// 의미가 없어진다.
export function drawSkillChoices(count = 3, random = Math.random) {
  const pool = [...SKILLS];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const index = Math.floor(random() * pool.length) % pool.length;
    picked.push(pool.splice(index, 1)[0].id);
  }
  return picked;
}
