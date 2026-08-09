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

function PresenterPanel({ socket }) {
  return html`
    <div class="presenter-panel">
      <div class="slide-preview">현재 슬라이드 미리보기</div>
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
function ParticipantCard({ participant, canReopen, onForceFinish, onReopen }) {
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
                      onForceFinish=${forceFinish}
                      onReopen=${reopen}
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
          : html`<ul class="error-log">${errors.map((e) => html`<li>[${e.context}] ${e.message}</li>`)}</ul>`}
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
