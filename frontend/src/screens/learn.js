import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 순수 정보 전달형 슬라이드. 넘김은 관리자가 전체 동기화로 제어한다 (docs/초안.md 7-① 참고).
export function LearnScreen({ socket }) {
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    fetch('./src/content/shapes-slides.json')
      .then((res) => res.json())
      .then(setSlides);
  }, []);

  useEffect(() => {
    socket.on('learn:slide', setSlideIndex);
    return () => socket.off('learn:slide', setSlideIndex);
  }, [socket]);

  const slide = slides[slideIndex];
  if (!slide) {
    return html`
      <div class="card slide-card">
        <p class="subtitle">학습 준비 중<span class="dots"><i></i><i></i><i></i></span></p>
      </div>
    `;
  }

  const pct = slides.length > 0 ? ((slideIndex + 1) / slides.length) * 100 : 0;

  // 이미지가 없는 슬라이드는 설명이 화면의 주인공이 된다 — 긴 설명용 왼쪽 정렬 대신
  // 가운데 정렬로 크게 보여줘야 한 문장짜리 안내가 허전해 보이지 않는다. 반대로 설명 없이
  // 이미지만 있는 슬라이드(PPT 원본을 통째로 캡처해 넣은 경우)는 그 이미지 자체가 이미
  // 완성된 슬라이드라 작은 카드 안 썸네일이 아니라 화면을 크게 채워야 한다.
  const layoutClass = slide.image ? (slide.description ? '' : 'slide-card--image') : 'slide-card--text';
  return html`
    <div class="card slide-card ${layoutClass}">
      <p class="slide-progress">${slideIndex + 1} / ${slides.length}</p>
      ${slide.title ? html`<h2>${slide.title}</h2>` : null}
      ${slide.image ? html`<img src=${slide.image} alt=${slide.title || `슬라이드 ${slideIndex + 1}`} />` : null}
      ${slide.description ? html`<p class="slide-desc">${slide.description}</p>` : null}
      <div class="slide-bar"><span style=${`width:${pct}%`}></span></div>
    </div>
  `;
}
