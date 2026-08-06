// 실제 맵 에셋이 아직 없어서 walls/spawnPoints는 플레이스홀더 — tools/map-coordinate-picker.html로
// 실제 배경 이미지를 보면서 좌표를 직접 지정한 뒤 이 파일만 교체하면 된다.
// 프론트엔드(브라우저)와 백엔드(Node) 양쪽이 이 파일을 그대로 import해서 쓴다(shapes/는 두
// 런타임이 공유하는 순수 로직 폴더, weaponRenderer.js와 같은 패턴) — arenaSize를 두 군데에
// 따로 하드코딩해서 값이 어긋나는 사고를 막기 위한 단일 소스.
export const DEFAULT_MAP = {
  arenaSize: { width: 2176, height: 1632 },
  imagePath: '/assets/maps/battle-map.png',
  walls: [

  ],
  spawnPoints: [
    {x:239,y:257},
    {x:232,y:354},
    {x:232,y:403},
    {x:276,y:477},
    {x:461,y:527},
    {x:539,y:621},
    {x:223,y:617},
    {x:512,y:342},
  ],
};
