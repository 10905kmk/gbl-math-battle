import { h, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { BattleScreen } from '../src/screens/battle.js';
import { SKILLS, formatSkillTiming } from '../shapes/skills.js';

const html = htm.bind(h);

// 기존 BattleScreen을 그대로 재사용하되, 이벤트 이름만 개발자 전용 채널로 바꾼다.
// 일반 battle:* 브로드캐스트와 섞이지 않아 실제 참가자의 라운드에는 영향을 주지 않는다.
function createDevSocket(realSocket, controlledIdRef) {
  const eventMap = {
    'battle:state': 'devBattle:state',
    'battle:result': 'devBattle:result',
    'battle:standings': 'devBattle:standings',
    'battle:events': 'devBattle:events',
    'battle:requestSync': 'devBattle:requestSync',
    'battle:input': 'devBattle:input',
    'battle:attack': 'devBattle:attack',
    'battle:skill': 'devBattle:skill',
  };
  return {
    get id() { return controlledIdRef.current ?? realSocket.id; },
    on(event, listener) { realSocket.on(eventMap[event] ?? event, listener); return this; },
    off(event, listener) { realSocket.off(eventMap[event] ?? event, listener); return this; },
    emit(event, payload) { realSocket.emit(eventMap[event] ?? event, payload); return this; },
  };
}

function DevBattleApp() {
  const [realSocket] = useState(() => io());
  const controlledIdRef = useRef(null);
  const devSocket = useMemo(() => createDevSocket(realSocket, controlledIdRef), [realSocket]);
  const battleState = useMemo(() => ({ battleResult: null }), []);
  const [connected, setConnected] = useState(false);
  const [controlledId, setControlledId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState(['heal', 'speedUp', 'dash']);
  const [activeSlot, setActiveSlot] = useState(0);
  const [hp, setHp] = useState(null);
  const [weaponType, setWeaponType] = useState('melee');
  const selected = SKILLS.find((skill) => skill.id === selectedSkills[activeSlot]);

  useEffect(() => {
    function start() {
      setConnected(true);
      realSocket.emit('devBattle:start');
    }
    function onDisconnect() { setConnected(false); }
    function onControlled({ playerId }) {
      controlledIdRef.current = playerId;
      setControlledId(playerId);
    }
    function onState(room) {
      setPlayers(Object.values(room?.players ?? {}));
      const me = room?.players?.[controlledIdRef.current ?? realSocket.id];
      if (!me) return;
      setSelectedSkills(me.skillIds ?? (me.skillId ? [me.skillId, 'speedUp', 'dash'] : ['heal', 'speedUp', 'dash']));
      setHp(me.hp);
      setWeaponType(me.isRanged ? 'ranged' : 'melee');
    }
    realSocket.on('connect', start);
    realSocket.on('disconnect', onDisconnect);
    realSocket.on('devBattle:controlled', onControlled);
    realSocket.on('devBattle:state', onState);
    if (realSocket.connected) start();
    const stop = () => realSocket.emit('devBattle:stop');
    window.addEventListener('beforeunload', stop);
    return () => {
      window.removeEventListener('beforeunload', stop);
      realSocket.off('connect', start);
      realSocket.off('disconnect', onDisconnect);
      realSocket.off('devBattle:controlled', onControlled);
      realSocket.off('devBattle:state', onState);
      realSocket.emit('devBattle:stop');
      realSocket.disconnect();
    };
  }, [realSocket]);

  function chooseSkill(skillId) {
    setSelectedSkills((previous) => {
      const next = [...previous];
      const previousSkill = next[activeSlot];
      const occupiedSlot = next.findIndex((id, index) => index !== activeSlot && id === skillId);
      // 같은 스킬을 두 키에 중복 배정하지 않는다. 이미 다른 키에 있으면 두 슬롯을 교환한다.
      if (occupiedSlot >= 0) next[occupiedSlot] = previousSkill;
      next[activeSlot] = skillId;
      realSocket.emit('devBattle:selectSkill', { slot: activeSlot, skillId });
      return next;
    });
  }

  function controlPlayer(playerId) {
    controlledIdRef.current = playerId;
    setControlledId(playerId);
    realSocket.emit('devBattle:controlPlayer', playerId);
  }

  function chooseWeaponType(nextType) {
    setWeaponType(nextType);
    realSocket.emit('devBattle:setWeaponType', nextType);
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
            <span><kbd>Z X C</kbd> 장착한 3개 스킬 사용</span>
            <span>현재 HP <strong>${hp ?? '-'}</strong></span>
          </div>
          <div class="dev-avatar-switcher">
            <span class="dev-avatar-label">시점·조종 아바타</span>
            ${players.map((player) => html`
              <button
                class="dev-avatar ${controlledId === player.id ? 'is-controlled' : ''}"
                onClick=${() => controlPlayer(player.id)}
              >
                <span>${player.characterId?.replace('char', '캐릭터 ')}</span>
                <strong>${player.name}</strong>
                <small>HP ${Math.ceil(player.hp ?? 0)}</small>
              </button>
            `)}
          </div>
          <${BattleScreen} key=${controlledId ?? 'connecting'} socket=${devSocket} state=${battleState} />
        </div>

        <aside class="dev-sidebar">
          <div class="dev-slot-picker">
            ${['Z', 'X', 'C'].map((key, index) => {
              const skill = SKILLS.find((item) => item.id === selectedSkills[index]);
              return html`
                <button type="button" class=${activeSlot === index ? 'is-active' : ''} onClick=${() => setActiveSlot(index)}>
                  <kbd>${key}</kbd><span>${skill ? `${skill.icon} ${skill.name}` : '선택하기'}</span>
                </button>
              `;
            })}
          </div>
          <div class="dev-selected" style=${`--skill-color:${selected?.color ?? '#2b7fd4'}`}>
            <span>${selected?.icon}</span>
            <div>
              <small>현재 스킬</small>
              <strong>${selected?.name}</strong>
              <p>${selected?.desc}</p>
            </div>
          </div>

          <div class="dev-actions">
            <button
              class=${`dev-weapon ${weaponType === 'melee' ? 'is-selected' : ''}`}
              onClick=${() => chooseWeaponType('melee')}
            >⚔ 근거리 무기</button>
            <button
              class=${`dev-weapon ${weaponType === 'ranged' ? 'is-selected' : ''}`}
              onClick=${() => chooseWeaponType('ranged')}
            >➶ 원거리 무기</button>
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
                class="dev-skill ${selectedSkills.includes(skill.id) ? 'is-selected' : ''}"
                style=${`--skill-color:${skill.color}`}
                title=${skill.desc}
                onClick=${() => chooseSkill(skill.id)}
              >
                <span>${skill.icon}</span>
                <strong>${skill.name}</strong>
                <p>${skill.desc}</p>
                <small>${formatSkillTiming(skill)}</small>
              </button>
            `)}
          </div>
          <p class="dev-passive-note">조합 테스트: Z·X·C 슬롯을 누른 뒤 각 스킬을 배정하세요. ‘최후의 발악’은 <b>내 체력 15%로</b>를 눌러 발동합니다.</p>
        </aside>
      </section>
    </main>
  `;
}

render(html`<${DevBattleApp} />`, document.getElementById('dev-battle-app'));
