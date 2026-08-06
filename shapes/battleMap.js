// 실제 맵 에셋이 아직 없어서 walls/spawnPoints는 플레이스홀더 — tools/map-coordinate-picker.html로
// 실제 배경 이미지를 보면서 좌표를 직접 지정한 뒤 이 파일만 교체하면 된다.
// 프론트엔드(브라우저)와 백엔드(Node) 양쪽이 이 파일을 그대로 import해서 쓴다(shapes/는 두
// 런타임이 공유하는 순수 로직 폴더, weaponRenderer.js와 같은 패턴) — arenaSize를 두 군데에
// 따로 하드코딩해서 값이 어긋나는 사고를 막기 위한 단일 소스.
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  // 아직 실제 이미지 파일이 없다 — frontend/assets/maps/에 파일을 넣고 이 경로만 맞추면 된다.
  // 파일이 없는 동안은 프론트엔드가 조용히 어두운 배경색으로 폴백한다(게임은 깨지지 않음).
  imagePath: '/assets/maps/battle-map.png',
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
  spawnPoints: [
    { x: 60, y: 60 },
    { x: 740, y: 60 },
    { x: 60, y: 540 },
    { x: 740, y: 540 },
    { x: 400, y: 550 },
    { x: 400, y: 60 },
    { x: 60, y: 300 },
    { x: 740, y: 300 },
  ],
};
