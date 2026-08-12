// 특수 스킬 정의 — 프론트(룰렛/버튼/파티클)와 백엔드(효과 판정)가 그대로 공유한다.
//
// 스킬 선정 기준(2026-08-09): 제안받은 27개 중 서로 "다른 축"을 담당하는 것만 남겼다.
// 중복이 많은 조합은 룰렛 후보에 여러 개가 같이 나와 고르는 재미가 사라진다.
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
    id: 'heal', name: '힐', icon: '✚', kind: 'self', activationDurationMs: 900, cooldownMs: 40000,
    desc: 'HP를 30% 회복합니다.',
    healPercent: 30, color: '#5fe3a1',
  },
  {
    id: 'shield', name: '실드', icon: '🛡', kind: 'self', activationDurationMs: 5000, cooldownMs: 35000,
    desc: '5초 동안 모든 피해를 받지 않습니다. 대쉬와 강화 대쉬 피해도 완전히 막습니다.',
    color: '#a98bff',
  },
  {
    id: 'reflect', name: '반사', icon: '🔯', kind: 'self', activationDurationMs: 3000, cooldownMs: 40000,
    desc: '3초 동안 받은 피해의 50%를 공격자에게 돌려줍니다. 자신도 원래 피해를 받으며 대쉬에도 적용됩니다.',
    reflectRatio: 0.5, color: '#c08bff',
  },

  // ── 이동 ───────────────────────────────────────────────────────────
  {
    id: 'speedUp', name: '속도증가', icon: '⚡', kind: 'self', activationDurationMs: 5000, cooldownMs: 40000,
    desc: '5초 동안 이동 속도가 3배가 됩니다. 속도증가 중 대쉬를 사용할 경우 대쉬 피해가 1.5배가 됩니다.',
    speedMultiplier: 3, color: '#5fe3a1',
  },
  {
    id: 'dash', name: '대쉬', icon: '💨', kind: 'self', activationDurationMs: 500, cooldownMs: 60000,
    desc: '7m 돌진하며 상대 원의 작은 절단 조각 면적 비율만큼 피해를 줍니다. 절단 피해가 40%를 넘으면 보너스 대쉬를 얻으며, 획득 후 10초 안에 쓰지 않으면 소멸합니다. 보너스는 최대 2회, 최초 대쉬까지 총 3회 가능합니다. 속도증가 또는 최후의 발악 중 대쉬를 사용할 경우 대쉬 피해가 1.5배입니다.',
    distance: 7 * METER, color: '#7cc4ff',
  },
  {
    id: 'blink', name: '순간이동', icon: '🔮', kind: 'shot', activationDurationMs: 1000, cooldownMs: 40000,
    desc: '하얀 진주를 던져 벽에 닿은 자리로 순간이동합니다.',
    projectileSpeed: 26, maxRange: 12 * METER, color: '#ffffff',
  },
  {
    id: 'recall', name: '텔레포트 백', icon: '⏪', kind: 'toggle', activationDurationMs: 40000, cooldownMs: 40000,
    desc: '누른 자리를 40초 동안 저장합니다. 40초 안에 다시 누르면 그 자리로 돌아가고, 그때부터 재사용 대기 40초가 시작됩니다.',
    color: '#7cc4ff',
  },

  // ── 군중 제어 ──────────────────────────────────────────────────────
  {
    id: 'slowHell', name: '속도지옥', icon: '🕸', kind: 'aura', activationDurationMs: 8000, cooldownMs: 60000,
    desc: '반경 5m 안의 적을 8초 동안 2.5배 느리게 만듭니다.',
    radius: 5 * METER, slowFactor: 2.5, color: '#8fd3ff',
  },
  {
    id: 'timeStop', name: '시간정지', icon: '⏱', kind: 'aura', activationDurationMs: 1500, cooldownMs: 40000,
    desc: '반경 5m 안의 모든 적을 1.5초 동안 정지시킵니다.',
    radius: 5 * METER, freeze: true, color: '#d5dbe6',
  },
  {
    id: 'shockwave', name: '충격파', icon: '💥', kind: 'aura', activationDurationMs: 600, cooldownMs: 35000,
    desc: '반경 5m 안의 모든 적을 강하게 밀쳐내고 최대 HP의 20% 피해를 줍니다.',
    radius: 5 * METER, knockback: 4 * METER, damagePercent: 20, color: '#ffffff',
  },
  {
    id: 'blackhole', name: '블랙홀', icon: '🕳', kind: 'place', activationDurationMs: 3000, cooldownMs: 45000,
    desc: '바라보는 곳에 검은 구체를 만들어 반경 4m 안의 적을 3초간 끌어당깁니다.',
    radius: 4 * METER, pullPerTick: 5, placeDistance: 3 * METER, color: '#a98bff',
  },
  {
    id: 'warrant', name: '연행영장', icon: '🚔', kind: 'cone', activationDurationMs: 500, cooldownMs: 25000,
    desc: '적 한 명을 자신 앞으로 끌고 옵니다.',
    range: 8 * METER, halfAngle: Math.PI / 5, color: '#ffa94d',
  },
  {
    id: 'coldplay', name: '콜드플레이', icon: '🧊', kind: 'cone', activationDurationMs: 2000, cooldownMs: 40000,
    desc: '앞쪽 부채꼴 안의 모든 적에게 5% 피해를 주고 2초 동안 얼립니다.',
    range: 8 * METER, halfAngle: Math.PI / 6, damagePercent: 5, color: '#8fd3ff',
  },

  // ── 공격 강화 ──────────────────────────────────────────────────────
  {
    id: 'poison', name: '독', icon: '☠', kind: 'self', activationDurationMs: 10000, cooldownMs: 20000,
    desc: '10초 안의 다음 공격 1회를 강화합니다. 명중하면 5초 동안 초당 1.5% 추가 피해.',
    dotMs: 5000, dotPercentPerSec: 1.5, color: '#7ddc6a',
  },
  {
    id: 'deathMark', name: '사형선고', icon: '🎯', kind: 'cone', activationDurationMs: 60000, cooldownMs: 40000,
    desc: '앞쪽의 적 한 명에게 모든 화면에서 보이는 과녁을 60초 동안 남깁니다. 시전자가 그 적에게 주는 피해가 20% 증가합니다.',
    range: 9 * METER, halfAngle: Math.PI / 5, damageBonus: 1.2, color: '#ff6b6b',
  },

  // ── 설치/은신 ──────────────────────────────────────────────────────
  {
    id: 'mine', name: '지뢰', icon: '💣', kind: 'place', activationDurationMs: 15000, cooldownMs: 35000,
    desc: '발밑에 지뢰를 15초 동안 설치합니다. 적이 1.5m 안에 들어오면 폭발해 50% 피해.',
    triggerRadius: 1.5 * METER, damagePercent: 50, knockback: 1.5 * METER, color: '#ff6b6b',
  },
  {
    id: 'cloak', name: '투명망토', icon: '👻', kind: 'self', activationDurationMs: 10000, cooldownMs: 40000,
    desc: '10초 동안 투명해지고 무적이 됩니다.',
    color: '#d5dbe6',
  },

  // ── 패시브 ─────────────────────────────────────────────────────────
  {
    id: 'lucky', name: '운빨', icon: '🍀', kind: 'passive', activationDurationMs: 500, cooldownMs: 1000,
    desc: '1초마다 한 번, 공격 시 15% 확률로 0.5초 동안 피해가 2.5배가 됩니다. (자동 발동)',
    chance: 0.15, multiplier: 2.5, color: '#ff6b6b',
  },
  {
    id: 'lastStand', name: '최후의 발악', icon: '🩸', kind: 'passive', activationDurationMs: 0, cooldownMs: 0,
    desc: 'HP가 20 이하인 동안 이동 속도는 3배, 공격력은 2.5배가 됩니다. 최후의 발악 중 대쉬를 사용할 경우 대쉬 피해가 1.5배가 됩니다. HP가 20을 넘거나 부활하면 해제되며, 대기시간 없이 자동 발동합니다.',
    thresholdHp: 20, speedMultiplier: 3, damageOut: 2.5, color: '#ff6b6b',
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function formatSkillTime(ms) {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}초`;
}

export function formatSkillTiming(skill) {
  if (skill?.id === 'lastStand') return '발동 HP 20 이하 동안 · 대기 없음';
  return `발동 ${formatSkillTime(skill?.activationDurationMs)} · 대기 ${formatSkillTime(skill?.cooldownMs)}`;
}

export function getSkill(skillId) {
  return SKILL_BY_ID[skillId] ?? null;
}

export function isValidSkillId(skillId) {
  return Boolean(SKILL_BY_ID[skillId]);
}

// 이동 속도 배율 — 버프(속도증가/최후의 발악)와 디버프(속도지옥)가 함께 걸릴 수 있으므로
// 곱해서 합친다. 얼면 0. shapes/에 둔 이유: 서버(battleSimulation.js의 moveOne)와 프론트
// 대전 화면(본인 캐릭터 이동 클라이언트 예측)이 완전히 같은 계산식을 써야 스킬 지속시간
// 내내 예측이 어긋나 떨리는 문제가 없다(Opus 리뷰 Important #3, 2026-08-11) — 이 함수는
// player.status와 이 파일의 getSkill만 참조하므로 두 런타임이 그대로 같이 쓸 수 있다.
export function speedMultiplier(player, now) {
  const s = player.status ?? {};
  if ((s.frozenUntil ?? 0) > now) return 0;
  let mul = 1;
  if ((s.speedUntil ?? 0) > now) mul *= s.speedMul ?? 1;
  if ((s.lastStandUntil ?? 0) > now) mul *= getSkill('lastStand').speedMultiplier;
  if ((s.slowUntil ?? 0) > now) mul /= s.slowMul ?? 1;
  return mul;
}

// 룰렛 후보에 서로 다른 스킬을 채운다.
export function drawSkillChoices(count = 3, random = Math.random) {
  const pool = [...SKILLS];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const index = Math.floor(random() * pool.length) % pool.length;
    picked.push(pool.splice(index, 1)[0].id);
  }
  return picked;
}
