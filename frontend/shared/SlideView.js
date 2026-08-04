import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

// 참가자(learn.js) / 공용화면(display.js) / 관리자 미리보기(admin.js) 세 곳에서 크기만 다르게 쓰는
// 슬라이드 레이아웃. variant는 shared/slide-view.css에서 크기만 조절하고, 마크업 구조는 항상 동일하게 유지한다.
export function SlideView({ slide, index, total, variant = 'default' }) {
  return html`
    <div class="slide-view slide-view--${variant}">
      <p class="slide-view-progress">${index + 1} / ${total}</p>
      <h2 class="slide-view-title">${slide.title}</h2>
      <img class="slide-view-image" src=${slide.image} alt=${slide.title} />
      <p class="slide-view-description">${slide.description}</p>
    </div>
  `;
}
