import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

const html = htm.bind(h);

// 전자칠판 등에 팝업으로 띄워두는 공용 화면. admin.js의 "공용 화면 열기" 버튼으로 연다.
// learn 단계는 슬라이드를 크게 보여주고, 그 외 단계는 안내 문구만 표시한다 (배틀 등 세부는 미정).
const STAGE_MESSAGES = {
  idle: '세션 시작을 기다리는 중입니다',
  create: '각자 화면에서 무기를 제작 중입니다',
  battle: '대전이 진행 중입니다',
  result: '결과를 확인하는 중입니다',
  thanks: '체험을 마쳐주셔서 감사합니다',
};

function DisplayApp() {
  const [stage, setStage] = useState('idle');
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const socket = io();
    socket.on('stage:change', setStage);
    socket.on('learn:slide', setSlideIndex);
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    fetch('../src/content/shapes-slides.json')
      .then((res) => res.json())
      .then(setSlides);
  }, []);

  if (stage === 'learn') {
    const slide = slides[slideIndex];
    if (!slide) return html`<div class="display-wait">슬라이드 준비 중...</div>`;
    return html`
      <div class="display-slide">
        <h1>${slide.title}</h1>
        <img src=${slide.image} alt=${slide.title} />
        <p>${slide.description}</p>
      </div>
    `;
  }

  return html`<div class="display-wait">${STAGE_MESSAGES[stage] ?? stage}</div>`;
}

render(html`<${DisplayApp} />`, document.getElementById('display-app'));
