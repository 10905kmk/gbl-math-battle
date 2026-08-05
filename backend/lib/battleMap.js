// 실제 맵 에셋이 아직 없어서 플레이스홀더 — 팀이 Manus 결과물 좌표를 얻으면 walls 배열만 교체.
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
};
