import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { BattleMapView } from './BattleMapView.js';

const html = htm.bind(h);

const STAGE_GUIDES = {
  idle: {
    step: '체험 준비',
    title: '수학 도형 무기 배틀에 오신 것을 환영합니다',
    description: '참가자 기기를 같은 와이파이에 연결하고 안내받은 주소로 접속해 주세요.',
    actions: ['참가자 화면에 접속하기', '진행자의 세션 시작 안내 기다리기'],
  },
  name: {
    step: '1 · 참가 등록',
    title: '내 화면에서 이름을 입력해 주세요',
    description: '입력한 이름은 전투 순위표에 표시됩니다. 이름 없이도 참여할 수 있습니다.',
    actions: ['이름 입력하기', '시작하기 누르기', '진행자의 다음 단계 기다리기'],
  },
  create: {
    step: '3 · 무기 제작',
    title: 'AI와 함께 나만의 기하학 무기를 만드세요',
    description: '채팅으로 모양을 설명하거나 도형을 직접 추가·이동·회전·복사할 수 있습니다.',
    actions: ['도형으로 무기 설계하기', '근접 또는 원거리 선택하기', '이름을 짓고 AI 평가받기'],
  },
  result: {
    step: '5 · 결과 확인',
    title: '내 무기와 전투 결과를 확인해 주세요',
    description: '참가자 화면에서 무기 점수와 순위를 확인하고 QR 또는 PDF로 저장할 수 있습니다.',
    actions: ['무기와 점수 확인하기', 'QR·PDF 저장하기', '진행자의 안내 기다리기'],
  },
  thanks: {
    step: '체험 완료',
    title: '참여해 주셔서 감사합니다!',
    description: '기하학과 AI로 만든 나만의 무기를 소중히 간직해 주세요.',
    actions: ['저장한 결과 확인하기', '다음 참가자를 위해 자리를 정리하기'],
  },
};

function StageGuide({ guide, progress }) {
  return html`
    <main class="stage-guide">
      <div class="guide-shape guide-shape--square"></div>
      <div class="guide-shape guide-shape--circle"></div>
      <section class="guide-card">
        <p class="guide-step">${guide.step}</p>
        <h1>${guide.title}</h1>
        <p class="guide-description">${guide.description}</p>
        <ol class="guide-actions">
          ${guide.actions.map((action, index) => html`<li><span>${index + 1}</span>${action}</li>`)}
        </ol>
        ${progress
          ? html`
              <div class="guide-progress">
                <div><span style=${`width:${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`}></span></div>
                <strong>제작 완료 ${progress.done} / ${progress.total}</strong>
              </div>
            `
          : null}
      </section>
    </main>
  `;
}

function DisplayApp() {
  const [stage, setStage] = useState('idle');
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [socket] = useState(() => io());

  useEffect(() => {
    socket.on('stage:change', setStage);
    socket.on('learn:slide', setSlideIndex);
    socket.on('create:progress', setProgress);
    return () => socket.disconnect();
  }, [socket]);

  useEffect(() => {
    fetch('../src/content/shapes-slides.json')
      .then((res) => res.json())
      .then(setSlides);
  }, []);

  if (stage === 'learn') {
    const slide = slides[slideIndex];
    // slides가 아직 비어 있으면(fetch 전) "준비 중", 이미 로드됐는데 index가 범위를 넘었으면
    // 마지막 슬라이드를 지나쳤다는 뜻이므로 서로 다른 문구를 보여준다.
    if (!slide) {
      return html`<div class="display-wait">${slides.length > 0 ? '마지막 슬라이드입니다' : '슬라이드 준비 중...'}</div>`;
    }
    return html`
      <div class="display-slide ${slide.image && !slide.description ? 'display-slide--image' : ''}">
        ${slide.title ? html`<h1>${slide.title}</h1>` : null}
        ${slide.image ? html`<img src=${slide.image} alt=${slide.title || `슬라이드 ${slideIndex + 1}`} />` : null}
        ${slide.description ? html`<p>${slide.description}</p>` : null}
      </div>
    `;
  }

  if (stage === 'battle') {
    return html`<${BattleMapView} socket=${socket} />`;
  }

  const guide = STAGE_GUIDES[stage] ?? STAGE_GUIDES.idle;
  return html`<${StageGuide} guide=${guide} progress=${stage === 'create' ? progress : null} />`;
}

render(html`<${DisplayApp} />`, document.getElementById('display-app'));
