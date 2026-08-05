// 실제 맵 에셋이 아직 없어서 플레이스홀더 — 팀이 Manus 결과물 좌표를 얻으면 walls 배열만 교체.
// SPAWN_POINTS는 walls와 같은 파일에 둬서, 맵을 교체할 때 스폰 지점이 새 벽 배치 안에
// 파묻히는 사고를 방지한다(캐릭터 반경 20px 기준으로 모든 벽에서 넉넉히 떨어뜨려 둠).
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
};

export const SPAWN_POINTS = [
  { x: 60, y: 60 },
  { x: 740, y: 60 },
  { x: 60, y: 540 },
  { x: 740, y: 540 },
  { x: 400, y: 550 },
  { x: 400, y: 60 },
  { x: 60, y: 300 },
  { x: 740, y: 300 },
];
