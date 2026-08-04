import { h } from 'preact';
import htm from 'htm';
import { useSlideSync } from '../../shared/slides.js';
import { SlideView } from '../../shared/SlideView.js';

const html = htm.bind(h);

// 순수 정보 전달형 슬라이드. 넘김은 관리자가 전체 동기화로 제어한다 (docs/초안.md 7-① 참고).
export function LearnScreen({ socket }) {
  const { slides, slideIndex, slide } = useSlideSync(socket);

  if (!slide) return html`<p>학습 준비 중...</p>`;

  return html`<${SlideView} slide=${slide} index=${slideIndex} total=${slides.length} variant="participant" />`;
}
