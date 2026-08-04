const cache = new Map();

// x/y는 10px 단위, rotation은 15도 단위로 반올림해서 "거의 같은 무기"를 같은 키로 수렴시킨다.
export function normalize(weaponState) {
  return [...weaponState.parts]
    .map((p) => ({
      shapeId: p.shapeId,
      x: Math.round(p.x / 10) * 10,
      y: Math.round(p.y / 10) * 10,
      // JS의 %는 음수 부호를 그대로 보존하므로(-30 % 360 === -30), +360 후 다시 %로 [0,360) 범위로 감는다.
      // Konva 드래그로 반시계 방향 회전하면 rotation이 자연스럽게 음수가 되므로 이 처리가 없으면
      // -30도와 330도(시각적으로 동일)가 다른 캐시 키로 갈라진다.
      rotation: (((Math.round(p.rotation / 15) * 15) % 360) + 360) % 360,
      scale: Math.round(p.scale * 10) / 10,
    }))
    .sort((a, b) => a.shapeId.localeCompare(b.shapeId) || a.x - b.x || a.y - b.y);
}

export function cacheKey(weaponState) {
  return JSON.stringify(normalize(weaponState));
}

// 같은 key는 항상 같은 정수를 [min, max] 범위 안에서 반환 (결정론적 해시 기반)
export function seededPick(key, min, max) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const range = max - min + 1;
  return min + (hash % range);
}

export function getCached(key) {
  return cache.get(key);
}

export function setCached(key, damage) {
  cache.set(key, damage);
}

// few-shot 샘플(팀이 미리 만든 무기-데미지 쌍)을 캐시에 미리 채워, 그 무기들은 AI 호출 없이 항상 정해진 값이 나가게 한다.
export function seedCache(samples) {
  for (const sample of samples) {
    cache.set(cacheKey(sample), sample.damage);
  }
}

export function cacheSize() {
  return cache.size;
}
