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
    // TODO: 남은 시간/참가자 진행도는 admin:status 브로드캐스트 구현 후 채우기 (docs/초안.md 8번 참고)
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
  }, [socket]);

  function openDisplay() {
    window.open('/admin/display.html', 'gbl-display', 'width=1280,height=720');
  }

  const doneCount = participants.filter((p) => p.done).length;

  return html`
    <div class="admin-shell">
      <header class="admin-topbar">
        <span>현재 단계: ${stage}</span>
        <span>남은 시간: ${remaining ?? '-'}</span>
        <span>진행도: ${doneCount}/${participants.length}</span>
        <button onClick=${() => socket.emit('admin:startSession')}>세션 시작</button>
        <button onClick=${() => socket.emit('admin:prevStage')}>이전 단계</button>
        <button onClick=${() => socket.emit('admin:nextStage')}>다음 단계</button>
        <button onClick=${() => socket.emit('admin:reset')}>전체 강제 리셋</button>
        <button onClick=${openDisplay}>공용 화면 열기</button>
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

// TODO: participants 상태 자체가 아직 채워지지 않음(session.js의 create:done 핸들러 미구현).
// 참가자별 "강제 진행" 버튼은 그 작업과 함께 다시 추가 (docs/초안.md 7-② 참고).
function DashboardPanel({ socket, participants }) {
  return html`
    <div class="dashboard-panel">
      <ul class="participant-list">
        ${participants.map((p) => html`
          <li>${p.name} — ${p.done ? '완료' : '진행 중'}</li>
        `)}
      </ul>
      <div class="error-log">에러 로그: 없음</div>
      <div class="submission-status">제출 현황: -</div>
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById('admin-app'));
