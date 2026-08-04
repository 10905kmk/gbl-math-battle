import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { useSlideSync } from '../shared/slides.js';
import { SlideView } from '../shared/SlideView.js';

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
  const [socket] = useState(() => io());
  const [stage, setStage] = useState('idle');
  const { slides, slideIndex, slide } = useSlideSync(socket);

  useEffect(() => {
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
  }, [socket]);

  if (stage === 'learn') {
    if (!slide) return html`<div class="display-wait">슬라이드 준비 중...</div>`;
    return html`<${SlideView} slide=${slide} index=${slideIndex} total=${slides.length} variant="display" />`;
  }

  return html`<div class="display-wait">${STAGE_MESSAGES[stage] ?? stage}</div>`;
}

render(html`<${DisplayApp} />`, document.getElementById('display-app'));
