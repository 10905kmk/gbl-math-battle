// 도형 구조 -> 공격/방어/특수효과 변환 로직
export function statsFromShape(shape) {
  return shape?.baseStats ?? { attack: 5, defense: 5 };
}
