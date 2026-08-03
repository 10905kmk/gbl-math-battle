import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

const html = htm.bind(h);

// 공통 상단바(stage/타이머/진행도/전역 버튼) + stage별 본문 전환. docs/초안.md 7-⑥ 참고.
function AdminApp() {
  const [socket] = useState(() => io());
  const [stage, setStage] = useState('idle');
  const [remaining, setRemaining] = useState(null);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    function onStatus(status) {
      setStage(status.stage);
      setRemaining(status.remaining);
      setParticipants(status.participants);
    }
    socket.on('admin:status', onStatus);
    return () => socket.off('admin:status', onStatus);
  }, [socket]);

  const doneCount = participants.filter((p) => p.done).length;

  return html`
    <div class="admin-shell">
      <header class="admin-topbar">
        <span>현재 단계: ${stage}</span>
        <span>남은 시간: ${remaining ?? '-'}</span>
        <span>진행도: ${doneCount}/${participants.length}</span>
        <button onClick=${() => socket.emit('admin:startSession')}>세션 시작</button>
        <button onClick=${() => socket.emit('admin:reset')}>전체 강제 리셋</button>
      </header>

      <main class="admin-body">
        ${stage === 'learn'
          ? html`<${PresenterPanel} socket=${socket} />`
          : html`<${DashboardPanel} socket=${socket} participants=${participants} />`}
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

function DashboardPanel({ socket, participants }) {
  return html`
    <div class="dashboard-panel">
      <ul class="participant-list">
        ${participants.map((p) => html`
          <li>
            ${p.name} — ${p.done ? '완료' : '진행 중'}
            ${!p.done ? html`<button onClick=${() => socket.emit('admin:forceAdvance', p.id)}>강제 진행</button>` : null}
          </li>
        `)}
      </ul>
      <div class="error-log">에러 로그: 없음</div>
      <div class="submission-status">제출 현황: -</div>
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById('admin-app'));
