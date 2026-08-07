import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

const html = htm.bind(h);

// 공통 상단바(stage/진행도/전역 버튼) + stage별 본문 전환. docs/초안.md 7-⑥,
// 2026-08-07 설계 문서 참고. "남은 시간"은 더 이상 표시하지 않는다 — battle을 제외한
// 모든 단계가 관리자 수동 전환으로 바뀌면서 표시할 서버 타이머 자체가 없어졌다(battle
// 단계 타이머는 BattleMapView.js/battle.js가 각자 이미 보여주고 있어 여기서 중복으로
// 가질 필요 없음).
function AdminApp() {
  const [socket] = useState(() => io());
  const [stage, setStage] = useState('idle');
  const [participants, setParticipants] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    function onNewError(entry) {
      setErrors((prev) => [entry, ...prev].slice(0, 20));
    }
    socket.on('stage:change', setStage);
    socket.on('admin:participants', setParticipants);
    socket.on('create:progress', setProgress);
    socket.on('admin:errorLog', setErrors);
    socket.on('admin:error', onNewError);
    return () => {
      socket.off('stage:change', setStage);
      socket.off('admin:participants', setParticipants);
      socket.off('create:progress', setProgress);
      socket.off('admin:errorLog', setErrors);
      socket.off('admin:error', onNewError);
    };
  }, [socket]);

  function openDisplay() {
    window.open('/admin/display.html', 'gbl-display', 'width=1280,height=720');
  }

  function forceFinish(participantId) {
    socket.emit('admin:forceFinish', participantId);
  }

  return html`
    <div class="admin-shell">
      <header class="admin-topbar">
        <span>현재 단계: ${stage}</span>
        <span>제작 완료: ${progress.done}/${progress.total}</span>
        <button onClick=${() => socket.emit('admin:startSession')}>세션 시작</button>
        <button onClick=${() => socket.emit('admin:prevStage')}>이전 단계</button>
        <button onClick=${() => socket.emit('admin:nextStage')}>다음 단계</button>
        <button onClick=${() => socket.emit('admin:reset')}>전체 강제 리셋</button>
        <button onClick=${openDisplay}>공용 화면 열기</button>
      </header>

      <main class="admin-body">
        ${stage === 'learn'
          ? html`<${PresenterPanel} socket=${socket} />`
          : html`<${DashboardPanel} participants=${participants} errors=${errors} onForceFinish=${forceFinish} />`}
      </main>
    </div>
  `;
}

function PresenterPanel({ socket }) {
  return html`
    <div class="presenter-panel">
      <div class="slide-preview">현재 슬라이드 미리보기</div>
      <div class="slide-controls">
        <button onClick=${() => socket.emit('admin:prevSlide')}>이전 슬라이드</button>
        <button onClick=${() => socket.emit('admin:nextSlide')}>다음 슬라이드</button>
      </div>
    </div>
  `;
}

function DashboardPanel({ participants, errors, onForceFinish }) {
  return html`
    <div class="dashboard-panel">
      <ul class="participant-list">
        ${participants.map((p) => html`
          <li>
            <span class="participant-name">${p.name ?? '이름 없음'}</span>
            <span class="participant-status">${p.createDone ? '제작 완료' : '제작 중'}</span>
            ${!p.createDone && html`<button onClick=${() => onForceFinish(p.id)}>기본 무기로 마감</button>`}
          </li>
        `)}
      </ul>
      <div class="error-log">
        <h3>에러 로그</h3>
        ${errors.length === 0
          ? html`<p>없음</p>`
          : html`<ul>${errors.map((e) => html`<li>[${e.context}] ${e.message}</li>`)}</ul>`}
      </div>
      <div class="submission-status">제출 현황: -</div>
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById('admin-app'));
