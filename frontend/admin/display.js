import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { BattleMapView } from './BattleMapView.js';

const html = htm.bind(h);

// 전자칠판 등에 팝업으로 띄워두는 공용 화면. admin.js의 "공용 화면 열기" 버튼으로 연다.
// learn 단계는 슬라이드를 크게 보여주고, battle 단계는 미니맵+리더보드, 그 외는 안내 문구만 표시한다.
const STAGE_MESSAGES = {
  idle: '세션 시작을 기다리는 중입니다',
  create: '각자 화면에서 무기를 제작 중입니다',
  result: '결과를 확인하는 중입니다',
  thanks: '체험을 마쳐주셔서 감사합니다',
};

function DisplayApp() {
  const [stage, setStage] = useState('idle');
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [socket] = useState(() => io());

  useEffect(() => {
    socket.on('stage:change', setStage);
    socket.on('learn:slide', setSlideIndex);
    return () => socket.disconnect();
  }, [socket]);

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

  if (stage === 'battle') {
    return html`<${BattleMapView} socket=${socket} />`;
  }

  return html`<div class="display-wait">${STAGE_MESSAGES[stage] ?? stage}</div>`;
}

render(html`<${DisplayApp} />`, document.getElementById('display-app'));
