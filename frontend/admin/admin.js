import { h, render, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { SKILLS, formatSkillTiming } from '../shapes/skills.js';

const html = htm.bind(h);
const SKILL_KIND_LABELS = {
  self: '자기 강화',
  aura: '범위 효과',
  cone: '전방 대상',
  place: '설치형',
  shot: '발사형',
  toggle: '2단계',
  passive: '패시브',
};

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
  const [standings, setStandings] = useState(null);
  const [moveSpeed, setMoveSpeed] = useState(8);
  const [battleDuration, setBattleDuration] = useState(180_000);
  const [battleState, setBattleState] = useState(null);
  const [checkinList, setCheckinList] = useState([]);
  const battleUiUpdateRef = useRef({ at: 0, status: null });

  useEffect(() => {
    function onNewError(entry) {
      setErrors((prev) => [entry, ...prev].slice(0, 20));
    }
    socket.on('stage:change', setStage);
    socket.on('admin:participants', setParticipants);
    socket.on('create:progress', setProgress);
    socket.on('admin:errorLog', setErrors);
    socket.on('admin:error', onNewError);
    socket.on('battle:standings', setStandings);
    socket.on('battle:moveSpeed', setMoveSpeed);
    socket.on('battle:duration', setBattleDuration);
    function onBattleState(room) {
      const now = Date.now();
      const previous = battleUiUpdateRef.current;
      // 관리자 전체 페이지는 위치 애니메이션을 직접 그리지 않는다(BattleMapView가 별도
      // 캔버스로 처리). 버튼/선택 현황만 초당 4회 갱신해 전체 관리자 DOM 20Hz 렌더를 막는다.
      if (room?.status !== previous.status || now - previous.at >= 250) {
        battleUiUpdateRef.current = { at: now, status: room?.status };
        setBattleState(room);
      }
    }
    socket.on('battle:state', onBattleState);
    socket.on('checkin:list', setCheckinList);
    // checkin:list는 실명/외부 허브 uid가 담겨 있어 관리자 화면만 구독한다(서버가 구독
    // 전에는 보내지 않는다) — 이 화면이 그 두 곳 중 하나다.
    socket.emit('checkin:subscribe');
    return () => {
      socket.off('stage:change', setStage);
      socket.off('admin:participants', setParticipants);
      socket.off('create:progress', setProgress);
      socket.off('admin:errorLog', setErrors);
      socket.off('admin:error', onNewError);
      socket.off('battle:standings', setStandings);
      socket.off('battle:moveSpeed', setMoveSpeed);
      socket.off('battle:duration', setBattleDuration);
      socket.off('battle:state', onBattleState);
      socket.off('checkin:list', setCheckinList);
    };
  }, [socket]);

  useEffect(() => {
    if (stage === 'battle') socket.emit('battle:requestSync');
  }, [socket, stage]);

  function openDisplay() {
    window.open('/admin/display.html', 'gbl-display', 'width=1280,height=720');
  }

  function openDevBattle() {
    window.open('/admin/dev-battle.html', 'gbl-dev-battle', 'width=1280,height=900');
  }

  function openCheckin() {
    window.open('/admin/checkin.html', 'gbl-checkin', 'width=480,height=800');
  }

  async function consumeCheckin() {
    try {
      const res = await fetch('/api/checkin/consume', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `체크인 등록에 실패했습니다 (${res.status})`);
      const okCount = data.results.filter((r) => r.status === 'ok').length;
      const failCount = data.results.length - okCount;
      alert(
        `체크인 등록 완료: 성공 ${okCount}건` +
          (failCount > 0 ? `, 실패 ${failCount}건(목록에 남아 재시도 가능)` : ''),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : '체크인 등록 중 네트워크 오류가 발생했습니다.');
    }
  }

  return html`
    <div class="admin-shell">
      <header class="admin-topbar">
        <span class="topbar-stage">단계 <strong>${stage}</strong></span>
        <span class="topbar-progress">제작 완료 <strong>${progress.done}/${progress.total}</strong></span>
        <div class="topbar-actions">
          <button onClick=${() => socket.emit('admin:startSession')}>세션 시작</button>
          <button onClick=${() => socket.emit('admin:prevStage')}>이전 단계</button>
          <button class="primary" onClick=${() => socket.emit('admin:nextStage')}>다음 단계</button>
          <button onClick=${openDisplay}>공용 화면 열기</button>
          <button onClick=${openCheckin}>체크인 화면 열기</button>
          <button disabled=${checkinList.length === 0} onClick=${consumeCheckin}>
            체크인 목록 소진 (${checkinList.length}건)
          </button>
          <button class="developer" onClick=${openDevBattle}>개발자 게임 테스트</button>
          <button
            class="danger"
            onClick=${() => {
              if (confirm('전체 세션을 강제로 리셋할까요? 진행 중인 대전과 참가자 진행 상황이 모두 초기화됩니다.')) {
                socket.emit('admin:reset');
              }
            }}
          >
            전체 강제 리셋
          </button>
        </div>
      </header>

      <main class="admin-body">
        ${stage === 'learn'
          ? html`<${PresenterPanel} socket=${socket} />`
          : html`
              <div class="dashboard-panel">
                ${stage === 'battle'
                  ? html`<${BattlePanel}
                      socket=${socket}
                      standings=${standings}
                      moveSpeed=${moveSpeed}
                      battleDuration=${battleDuration}
                      battleState=${battleState}
                    />`
                  : null}
                <${DashboardPanel} socket=${socket} stage=${stage} participants=${participants} errors=${errors} />
              </div>
            `}
      </main>
    </div>
  `;
}

// 슬라이드 1장 미리보기 — "현재"/"다음" 두 칸에서 재사용한다. total===0(아직 fetch 전)과
// index가 범위를 넘은 경우("다음"이 없거나 마지막을 넘겨 넘긴 경우)를 구분해야, 로딩 중을
// "마지막 슬라이드"로 잘못 표시하지 않는다.
function SlidePreviewCard({ label, slides, index }) {
  const total = slides.length;
  const slide = slides[index];
  return html`
    <div class="slide-preview-card">
      <p class="slide-preview-label">${label}${total > 0 ? html` <span>${Math.min(index + 1, total)} / ${total}</span>` : ''}</p>
      ${total === 0
        ? html`<p class="slide-preview-status">학습 준비 중...</p>`
        : !slide
          ? html`<p class="slide-preview-status">마지막 슬라이드입니다</p>`
          : html`
              <div class="slide-preview-content">
                ${slide.title ? html`<h3>${slide.title}</h3>` : null}
                ${slide.image ? html`<img src=${slide.image} alt=${slide.title || `슬라이드 ${index + 1}`} />` : null}
                ${slide.description ? html`<p>${slide.description}</p>` : null}
              </div>
            `}
    </div>
  `;
}

function PresenterPanel({ socket }) {
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    fetch('../src/content/shapes-slides.json')
      .then((res) => res.json())
      .then(setSlides);
  }, []);

  useEffect(() => {
    socket.on('learn:slide', setSlideIndex);
    return () => socket.off('learn:slide', setSlideIndex);
  }, [socket]);

  useEffect(() => {
    // PPT 리모컨(클리커)은 대부분 화살표/PageUp·Down/Space를 표준 키보드 이벤트로 보낸다 —
    // 별도 기기 연동 없이 이 리스너 하나로 커버된다. 다른 입력 필드에 포커스가 있으면
    // 방해하지 않도록 무시(지금 이 패널엔 텍스트 입력이 없지만 방어적으로 둔다).
    function onKeyDown(event) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        socket.emit('admin:nextSlide');
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp' || event.key === 'Backspace') {
        event.preventDefault();
        socket.emit('admin:prevSlide');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [socket]);

  return html`
    <div class="presenter-panel">
      <div class="slide-preview-row">
        <${SlidePreviewCard} label="현재 슬라이드" slides=${slides} index=${slideIndex} />
        <${SlidePreviewCard} label="다음 슬라이드" slides=${slides} index=${slideIndex + 1} />
      </div>
      <div class="slide-controls">
        <button onClick=${() => socket.emit('admin:prevSlide')}>이전 슬라이드</button>
        <button class="primary" onClick=${() => socket.emit('admin:nextSlide')}>다음 슬라이드</button>
      </div>
    </div>
  `;
}

// 참가자 1명 = 카드 1장. 이름/상태만 나열하던 목록으로는 "누가 무엇을 만들었는지"를 볼 수
// 없어서, 실수로 평가받은 참가자를 구제할 때 그 사람이 맞는지 확인할 방법이 없었다 —
// 무기 썸네일/이름/전투력까지 같이 보여주고 개별 조치 버튼을 카드 안에 둔다.
function ParticipantCard({ participant, canReopen, canResetDevice, onForceFinish, onReopen, onKick, onResetDevice }) {
  const { name, createDone, weapon } = participant;
  const label = name ?? '이름 없음';

  return html`
    <li class="participant-card ${createDone ? 'is-done' : 'is-working'}">
      <div class="participant-thumb">
        ${weapon?.image
          ? html`<img src=${weapon.image} alt=${weapon?.name ?? '무기'} />`
          : html`<span class="participant-thumb--empty">${createDone ? '이미지 없음' : '제작 중'}</span>`}
      </div>

      <div class="participant-info">
        <div class="participant-head">
          <span class="participant-name">${label}</span>
          <span class="badge ${createDone ? 'badge--done' : 'badge--working'}">
            ${createDone ? '제작 완료' : '제작 중'}
          </span>
        </div>
        ${createDone
          ? html`
              <p class="participant-weapon">
                <strong>${weapon?.name ?? '무기'}</strong>
                <span class="participant-damage">전투력 ${weapon?.damage ?? '-'}</span>
                <span class="participant-range">${weapon?.attackRange === 'ranged' ? '원거리' : '근접'}</span>
              </p>
            `
          : html`<p class="participant-weapon participant-weapon--empty">아직 평가받지 않았어요</p>`}
      </div>

      <div class="participant-actions">
        ${!createDone &&
        html`<button onClick=${() => onForceFinish(participant.id)}>기본 무기로 마감</button>`}
        ${createDone &&
        canReopen &&
        html`
          <button
            class="rescue"
            title="실수로 평가받은 참가자를 편집 화면으로 되돌립니다"
            onClick=${() => onReopen(participant.id, label)}
          >
            ↩ 제작 완료 취소
          </button>
        `}
        ${canResetDevice &&
        html`
          <button
            class="rescue"
            title="이 기기의 이름/제작 상태를 지우고 새 참가자를 받을 수 있게 합니다(체크인 연결도 함께 해제)"
            onClick=${() => onResetDevice(participant.id, label)}
          >
            ⟲ 기기 초기화
          </button>
        `}
        <button
          class="kick"
          title="이 참가자의 연결을 서버가 강제로 끊습니다(유령/이름없음 정리용)"
          onClick=${() => onKick(participant.id, label)}
        >
          ⏻ 강제 연결 끊기
        </button>
      </div>
    </li>
  `;
}

function ApiKeyPanel() {
  const [status, setStatus] = useState({ count: 0, providers: {} });
  const [slotStatus, setSlotStatus] = useState({
    capacityPerKey: 2,
    totals: { active: 0, queued: 0, capacity: 0 },
    slots: [],
  });
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  async function refreshStatus() {
    try {
      const [keysRes, slotsRes] = await Promise.all([
        fetch('/api/admin/api-keys'),
        fetch('/api/admin/ai-slots'),
      ]);
      if (keysRes.ok) setStatus(await keysRes.json());
      if (slotsRes.ok) setSlotStatus(await slotsRes.json());
    } catch {
      // 상태 표시는 보조 기능이다. 서버 연결이 잠시 끊겨도 관리자 전체 화면은 유지한다.
    }
  }

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 1000);
    return () => clearInterval(timer);
  }, []);

  async function saveApiKey(event) {
    event.preventDefault();
    if (!password || !apiKey.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, apiKey: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'API 키를 저장하지 못했습니다.');
      setStatus(data);
      await refreshStatus();
      setApiKey('');
      const providerNames = { gemini: 'Gemini', github: 'GitHub Models', openrouter: 'OpenRouter' };
      setNotice({ ok: true, text: data.added ? `새 ${providerNames[data.addedProvider] ?? 'AI'} API 키를 추가했습니다. 바로 사용됩니다.` : '이미 등록된 키입니다.' });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'API 키를 저장하지 못했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  return html`
    <section class="panel api-key-panel">
      <div class="panel-head">
        <div>
          <h2>긴급 AI API 키</h2>
          <span class="panel-sub">현재 ${status.count}개 등록됨</span>
        </div>
        <div class="api-key-badges">
          ${Object.entries(status.providers ?? {}).flatMap(([provider, item]) =>
            (item.maskedKeys ?? []).map((masked) => html`<code>${provider} ${masked}</code>`))}
        </div>
      </div>
      <p class="api-key-help">Gemini, GitHub Models, OpenRouter 키를 형식에 따라 자동 분류합니다. 입력한 키 원문은 다시 화면에 표시되지 않습니다.</p>
      <div class="ai-slot-summary">
        <strong>AI 슬롯 현황</strong>
        <span>실행 중 ${slotStatus.totals?.active ?? 0}/${slotStatus.totals?.capacity ?? 0}</span>
        <span>대기 ${slotStatus.totals?.queued ?? 0}건</span>
      </div>
      <div class="ai-slot-grid">
        ${(slotStatus.slots ?? []).map((slot) => html`
          <article class="ai-slot-card ${slot.active >= slot.capacity ? 'is-full' : ''}">
            <div class="ai-slot-head">
              <strong>${slot.label}</strong>
              <code>${slot.maskedKey}</code>
            </div>
            <div class="ai-slot-meter" aria-label="${slot.active}/${slot.capacity}개 슬롯 사용 중">
              ${Array.from({ length: slot.capacity }, (_, index) => html`
                <i class=${index < slot.active ? 'is-active' : ''}></i>
              `)}
            </div>
            <dl>
              <div><dt>사용 중</dt><dd>${slot.active}/${slot.capacity}</dd></div>
              <div><dt>대기열</dt><dd>${slot.queued}건</dd></div>
              <div><dt>완료</dt><dd>${slot.completed}건</dd></div>
              <div><dt>실패</dt><dd>${slot.failed}건</dd></div>
            </dl>
            ${slot.lastErrorStatus
              ? html`<p class="ai-slot-error">최근 오류 ${slot.lastErrorStatus}</p>`
              : html`<p class="ai-slot-ready">정상 대기</p>`}
          </article>
        `)}
      </div>
      <form class="api-key-form" onSubmit=${saveApiKey}>
        <label>
          <span>관리자 비밀번호</span>
          <input type="password" value=${password} onInput=${(e) => setPassword(e.target.value)} autocomplete="current-password" />
        </label>
        <label class="api-key-field">
          <span>새 AI API 키</span>
          <input type="password" value=${apiKey} onInput=${(e) => setApiKey(e.target.value)} autocomplete="off" placeholder="AIza… / ghp_… / sk-or-v1-…" />
        </label>
        <button class="primary" type="submit" disabled=${saving || !password || !apiKey.trim()}>
          ${saving ? '저장 중…' : 'API 키 추가'}
        </button>
      </form>
      ${notice ? html`<p class="api-key-notice ${notice.ok ? 'is-ok' : 'is-error'}">${notice.text}</p>` : null}
    </section>
  `;
}

function DashboardPanel({ socket, stage, participants, errors }) {
  // 되돌리기는 create 단계에서만 의미가 있다(서버도 같은 조건으로 막는다) — battle로
  // 넘어간 뒤엔 이미 대전 시작 시점의 참가자 스냅샷이 떠 있어서 되돌려도 반영되지 않는다.
  const canReopen = stage === 'create';
  const doneCount = participants.filter((p) => p.createDone).length;

  function forceFinish(participantId) {
    socket.emit('admin:forceFinish', participantId);
  }

  function reopen(participantId, name) {
    if (!confirm(`"${name}"님의 제작 완료를 취소하고 편집 화면으로 되돌릴까요?\n\n평가받은 전투력은 사라지고 다시 평가받아야 합니다. 만들던 도형은 그대로 남아 있어요.`)) {
      return;
    }
    socket.emit('admin:reopenCreate', participantId);
  }

  function kick(participantId, name) {
    if (!confirm(`"${name}"님의 연결을 강제로 끊을까요?\n\n실제 참가자라면 다시 접속해야 합니다 — 유령/이름없는 연결 정리용으로만 쓰세요.`)) {
      return;
    }
    socket.emit('admin:kickParticipant', participantId);
  }

  function resetDevice(participantId, name) {
    if (
      !confirm(
        `"${name}" 기기를 초기화하고 새 참가자를 받을까요?\n\n이름과 제작 진행 상태가 모두 지워집니다. 이 참가자의 체크인 방문 기록은 유지되어 체크인 화면에서 별도로 관리됩니다.`,
      )
    ) {
      return;
    }
    socket.emit('admin:resetParticipant', participantId);
  }

  // 바깥(AdminApp)이 .dashboard-panel 컨테이너를 들고 있으므로 여기서는 section들만 낸다 —
  // 대전 단계에서는 BattlePanel이 같은 컨테이너 안에 형제로 함께 들어간다.
  return html`
    <${Fragment}>
      <${ApiKeyPanel} />
      <section class="panel">
        <div class="panel-head">
          <h2>참가자 (${participants.length}명)</h2>
          <span class="panel-sub">제작 완료 ${doneCount}명</span>
        </div>
        ${participants.length === 0
          ? html`<p class="empty">접속한 참가자가 없습니다.</p>`
          : html`
              <ul class="participant-list">
                ${participants.map(
                  (p) => html`
                    <${ParticipantCard}
                      key=${p.id}
                      participant=${p}
                      canReopen=${canReopen}
                      canResetDevice=${stage !== 'battle'}
                      onForceFinish=${forceFinish}
                      onReopen=${reopen}
                      onKick=${kick}
                      onResetDevice=${resetDevice}
                    />
                  `,
                )}
              </ul>
            `}
        ${!canReopen && doneCount > 0
          ? html`<p class="panel-note">제작 완료 취소는 <strong>제작(create) 단계</strong>에서만 할 수 있어요.</p>`
          : null}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>에러 로그</h2></div>
        ${errors.length === 0
          ? html`<p class="empty">없음</p>`
          : html`<ul class="error-log">${errors.map((e) => html`
              <li>
                [${e.context}] ${e.message}
                ${e.detail ? html`<pre class="error-log-detail">${e.detail}</pre>` : null}
              </li>
            `)}</ul>`}
      </section>
    <//>
  `;
}

// 대전 단계 전용 패널 — 이동 속도 조절, 판 진행(새로운 판 / 부스 종료), 최종 순위표.
function BattlePanel({ socket, standings, moveSpeed, battleDuration, battleState }) {
  const rows = standings?.standings ?? [];
  const livePlayers = Object.values(battleState?.players ?? {}).filter((p) => p.connected !== false);
  const pickedCount = livePlayers.filter((p) => p.skillSelectionConfirmed === true).length;
  const playerCount = livePlayers.length;
  const battleStatus = battleState?.status ?? null;
  const canStartCountdown = battleStatus === 'roulette' && playerCount > 0;
  const canSetDuration = battleStatus !== 'active' && battleStatus !== 'countdown';
  const remainingSeconds = battleStatus === 'active' && Number.isFinite(battleState?.endsAt)
    ? Math.max(0, Math.ceil((battleState.endsAt - Date.now()) / 1000))
    : null;
  const remainingLabel = remainingSeconds === null
    ? `${Math.floor(battleDuration / 60_000)}:${String((battleDuration / 1000) % 60).padStart(2, '0')} 설정`
    : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  const statusLabel = standings
    ? `${standings.round}판 종료 — 순위 발표 중`
    : battleStatus === 'roulette'
      ? `특수 스킬 선택 ${pickedCount}/${playerCount}`
      : battleStatus === 'countdown'
        ? '5초 카운트다운 중'
        : battleStatus === 'active'
          ? '게임 진행 중'
          : '대전 준비 중';

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>대전 진행</h2>
        <span class="panel-sub">${statusLabel}</span>
      </div>

      ${battleStatus === 'roulette' && !standings
        ? html`
            <div class="battle-start-gate ${canStartCountdown ? 'is-ready' : ''}">
              <div>
                <strong>특수 스킬 선택 ${pickedCount}/${playerCount}</strong>
                <p>${pickedCount === playerCount
                  ? '전원이 선택했습니다. 준비되면 게임을 시작하세요.'
                  : '지금 시작하면 선택을 끝내지 않은 참가자의 남은 스킬은 자동 배정됩니다.'}</p>
              </div>
              <button
                class="primary"
                disabled=${!canStartCountdown}
                onClick=${() => socket.emit('admin:startBattleCountdown')}
              >
                5초 카운트다운 시작
              </button>
            </div>
          `
        : null}

      <label class="speed-row">
        <span class="speed-label">이동 속도</span>
        <input
          type="range"
          min="3"
          max="20"
          step="1"
          value=${moveSpeed}
          onInput=${(e) => socket.emit('admin:setMoveSpeed', Number(e.target.value))}
        />
        <output class="speed-value">${moveSpeed}</output>
      </label>
      <p class="panel-note">
        진행 중인 판에도 즉시 적용됩니다. 기본값 8(예전 4) — 초당 이동 거리는 값 × 20px입니다.
      </p>

      <div class="battle-time-row">
        <div>
          <span class="speed-label">게임 시간</span>
          <strong>${remainingLabel}</strong>
        </div>
        <div class="battle-time-actions">
          <button
            disabled=${!canSetDuration || battleDuration <= 30_000}
            onClick=${() => socket.emit('admin:setBattleDuration', battleDuration - 30_000)}
          >
            -30초
          </button>
          <button
            disabled=${!canSetDuration || battleDuration >= 1_200_000}
            onClick=${() => socket.emit('admin:setBattleDuration', battleDuration + 30_000)}
          >
            +30초
          </button>
          <button
            class="primary"
            disabled=${battleStatus !== 'active'}
            title=${battleStatus === 'active' ? '현재 게임 시간을 30초 연장합니다' : '게임 진행 중에 사용할 수 있습니다'}
            onClick=${() => socket.emit('admin:addBattleTime')}
          >
            진행 중 +30초
          </button>
        </div>
      </div>

      <div class="round-actions">
        <button
          class="primary"
          disabled=${!standings}
          title=${standings ? '같은 참가자/무기로 다음 판을 시작합니다' : '판이 끝난 뒤에 누를 수 있어요'}
          onClick=${() => socket.emit('admin:newRound')}
        >
          ▶ 새로운 판
        </button>
        <button
          class="danger"
          onClick=${() => {
            if (confirm('부스를 종료할까요?\n\n마지막 판의 점수로 결과를 저장하고 참가자 화면을 결과(QR/PDF)로 넘깁니다.')) {
              socket.emit('admin:endBooth');
            }
          }}
        >
          ■ 부스 종료
        </button>
      </div>

      <details class="skill-catalog" open>
        <summary>특수 스킬 목록 <span>${SKILLS.length}개</span></summary>
        <div class="skill-catalog-grid">
          ${SKILLS.map(
            (skill) => html`
              <article class="skill-catalog-card" style=${`--skill-color:${skill.color}`}>
                <span class="skill-catalog-icon">${skill.icon}</span>
                <div>
                  <div class="skill-catalog-head">
                    <strong>${skill.name}</strong>
                    <span>${SKILL_KIND_LABELS[skill.kind] ?? skill.kind}</span>
                  </div>
                  <p>${skill.desc}</p>
                  <small>
                    ${formatSkillTiming(skill)}
                    ${skill.kind === 'passive' ? ' · 자동' : ''}
                  </small>
                </div>
              </article>
            `,
          )}
        </div>
      </details>

      ${rows.length > 0
        ? html`
            <table class="admin-standings">
              <thead>
                <tr><th>순위</th><th class="col-name">이름</th><th>킬</th><th>데스</th><th>어시</th><th>종합</th></tr>
              </thead>
              <tbody>
                ${rows.map(
                  (p) => html`
                    <tr class=${p.rank === 1 ? 'is-top' : ''}>
                      <td>${p.rank}</td>
                      <td class="col-name">${p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`}</td>
                      <td>${p.kills}</td>
                      <td>${p.deaths}</td>
                      <td>${p.assists}</td>
                      <td class="col-score">${p.score}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          `
        : null}
    </section>
  `;
}

render(html`<${AdminApp} />`, document.getElementById('admin-app'));
