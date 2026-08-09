import { h, render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { BattleScreen } from '../src/screens/battle.js';
import { SKILLS } from '../shapes/skills.js';

const html = htm.bind(h);

// 기존 BattleScreen을 그대로 재사용하되, 이벤트 이름만 개발자 전용 채널로 바꾼다.
// 일반 battle:* 브로드캐스트와 섞이지 않아 실제 참가자의 라운드에는 영향을 주지 않는다.
function createDevSocket(realSocket) {
  const eventMap = {
    'battle:state': 'devBattle:state',
    'battle:result': 'devBattle:result',
    'battle:standings': 'devBattle:standings',
    'battle:requestSync': 'devBattle:requestSync',
    'battle:input': 'devBattle:input',
    'battle:attack': 'devBattle:attack',
    'battle:skill': 'devBattle:skill',
  };
  return {
    get id() { return realSocket.id; },
    on(event, listener) { realSocket.on(eventMap[event] ?? event, listener); return this; },
    off(event, listener) { realSocket.off(eventMap[event] ?? event, listener); return this; },
    emit(event, payload) { realSocket.emit(eventMap[event] ?? event, payload); return this; },
  };
}

function DevBattleApp() {
  const [realSocket] = useState(() => io());
  const devSocket = useMemo(() => createDevSocket(realSocket), [realSocket]);
  const [connected, setConnected] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState('heal');
  const [hp, setHp] = useState(null);
  const selected = SKILLS.find((skill) => skill.id === selectedSkill);

  useEffect(() => {
    function start() {
      setConnected(true);
      realSocket.emit('devBattle:start');
    }
    function onDisconnect() { setConnected(false); }
    function onState(room) {
      const me = room?.players?.[realSocket.id];
      if (!me) return;
      setSelectedSkill(me.skillId ?? 'heal');
      setHp(me.hp);
    }
    realSocket.on('connect', start);
    realSocket.on('disconnect', onDisconnect);
    realSocket.on('devBattle:state', onState);
    if (realSocket.connected) start();
    const stop = () => realSocket.emit('devBattle:stop');
    window.addEventListener('beforeunload', stop);
    return () => {
      window.removeEventListener('beforeunload', stop);
      realSocket.off('connect', start);
      realSocket.off('disconnect', onDisconnect);
      realSocket.off('devBattle:state', onState);
      realSocket.emit('devBattle:stop');
      realSocket.disconnect();
    };
  }, [realSocket]);

  function chooseSkill(skillId) {
    setSelectedSkill(skillId);
    realSocket.emit('devBattle:selectSkill', skillId);
  }

  return html`
    <main class="dev-shell">
      <header class="dev-header">
        <div>
          <span class="dev-badge">DEVELOPER MODE</span>
          <h1>특수스킬 테스트 경기</h1>
          <p>일반 참가자 게임과 분리된 테스트 방입니다. 이 창을 닫으면 자동으로 종료됩니다.</p>
        </div>
        <span class="dev-connection ${connected ? 'is-online' : ''}">${connected ? '테스트 서버 연결됨' : '연결 중'}</span>
      </header>

      <section class="dev-layout">
        <div class="dev-game-column">
          <div class="dev-help">
            <span><kbd>WASD</kbd> 이동</span>
            <span><kbd>마우스</kbd> 조준·클릭 공격</span>
            <span><kbd>Z</kbd> 선택한 스킬 사용</span>
            <span>현재 HP <strong>${hp ?? '-'}</strong></span>
          </div>
          <${BattleScreen} socket=${devSocket} state=${{ battleResult: null }} />
        </div>

        <aside class="dev-sidebar">
          <div class="dev-selected" style=${`--skill-color:${selected?.color ?? '#2b7fd4'}`}>
            <span>${selected?.icon}</span>
            <div>
              <small>현재 스킬</small>
              <strong>${selected?.name}</strong>
              <p>${selected?.desc}</p>
            </div>
          </div>

          <div class="dev-actions">
            <button onClick=${() => realSocket.emit('devBattle:resetCooldown')}>쿨타임·효과 초기화</button>
            <button onClick=${() => realSocket.emit('devBattle:lowHp')}>내 체력 15%로</button>
            <button class="dev-reset" onClick=${() => realSocket.emit('devBattle:reset')}>전체 테스트 초기화</button>
          </div>

          <div class="dev-skill-head">
            <strong>모든 특수스킬</strong>
            <span>${SKILLS.length}개</span>
          </div>
          <div class="dev-skill-grid">
            ${SKILLS.map((skill) => html`
              <button
                class="dev-skill ${selectedSkill === skill.id ? 'is-selected' : ''}"
                style=${`--skill-color:${skill.color}`}
                title=${skill.desc}
                onClick=${() => chooseSkill(skill.id)}
              >
                <span>${skill.icon}</span>
                <strong>${skill.name}</strong>
                <small>${skill.kind === 'passive' ? '자동 발동' : `${Math.round(skill.cooldownMs / 1000)}초`}</small>
              </button>
            `)}
          </div>
          <p class="dev-passive-note">패시브 테스트: ‘최후의 발악’을 고른 뒤 <b>내 체력 15%로</b>를 누르세요.</p>
        </aside>
      </section>
    </main>
  `;
}

render(html`<${DevBattleApp} />`, document.getElementById('dev-battle-app'));
