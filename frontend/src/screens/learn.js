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
  if (!slide) return html`<p>학습 준비 중...</p>`;

  return html`
    <div class="slide-card">
      <p class="slide-progress">${slideIndex + 1} / ${slides.length}</p>
      <h2>${slide.title}</h2>
      <img src=${slide.image} alt=${slide.title} />
      <p>${slide.description}</p>
    </div>
  `;
}
