import { useState, useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../game/GameScene';
import { GameEngine } from '../game/gameEngine';
import type { GameState, HeroClass, PlayerState } from '../types/gameTypes';

const F = "'Courier New', Courier, monospace";
const GOLD = '#c9a84c';
const GOLD_DIM = 'rgba(201,168,76,0.4)';
const BG = '#07070d';
const RED = '#c0392b';
const GRAY = '#555';
const WHITE = '#e8e8e8';

const HERO_INFO: Record<HeroClass, { icon: string; hp: number; atk: number; def: number; spd: number; ability: string; tip: string }> = {
  Warrior: { icon: '⚔', hp: 120, atk: 25, def: 10, spd: 7,  ability: 'Shield Block', tip: 'Next hit halved. Gains Rage on damage.' },
  Wizard:  { icon: '🔥', hp: 60,  atk: 10, def: 3,  spd: 10, ability: 'Fireball',    tip: 'Blasts all enemies in the room.' },
  Archer:  { icon: '🏹', hp: 85,  atk: 18, def: 6,  spd: 14, ability: 'Multi-Shot',  tip: 'Fires at 2 targets. High crit chance.' },
};

function resourceColor(name: string) {
  if (name === 'Mana') return '#2980b9';
  if (name === 'Rage') return '#e67e22';
  return '#27ae60';
}

function MiniBar({ val, max, color }: { val: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
    </div>
  );
}

function PlayerHud({ p, isMe }: { p: PlayerState; isMe: boolean }) {
  const rc = resourceColor(p.resourceName);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3,
      padding: '5px 8px',
      background: isMe ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isMe ? GOLD_DIM : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 2,
      minWidth: 140, maxWidth: 200,
      opacity: p.isAlive ? 1 : 0.4,
      fontFamily: F,
    }}>
      <div style={{ fontSize: 10, color: isMe ? GOLD : WHITE, letterSpacing: '0.05em' }}>
        {p.username} <span style={{ color: GRAY }}>({p.heroClass})</span>
        {!p.isAlive && <span style={{ color: RED }}> DEAD</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 9, color: RED, width: 14 }}>HP</span>
        <MiniBar val={p.currentHp} max={p.maxHp} color={RED} />
        <span style={{ fontSize: 9, color: GRAY, whiteSpace: 'nowrap' }}>{p.currentHp}/{p.maxHp}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 9, color: rc, width: 14 }}>{p.resourceName.slice(0,2)}</span>
        <MiniBar val={p.resource} max={p.maxResource} color={rc} />
        <span style={{ fontSize: 9, color: GRAY, whiteSpace: 'nowrap' }}>{p.resource}/{p.maxResource}</span>
      </div>
    </div>
  );
}

type Phase = 'hero-select' | 'connecting' | 'playing';

interface Props { username: string; userId: string; onBack: () => void; }

export default function GamePage({ username, userId, onBack }: Props) {
  const [phase, setPhase]             = useState<Phase>('hero-select');
  const [heroClass, setHeroClass]     = useState<HeroClass>('Warrior');
  const [joinCode, setJoinCode]       = useState('');
  const [joinError, setJoinError]     = useState('');
  const [connectError, setConnectError] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [gameState, setGameState]     = useState<GameState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef      = useRef<Phaser.Game | null>(null);
  const engineRef    = useRef<GameEngine | null>(null);

  // Mount Phaser when entering 'playing' phase
  useEffect(() => {
    if (phase !== 'playing' || !containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      backgroundColor: '#07070d',
      scene: [GameScene],
      parent: containerRef.current,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 640,
      },
      render: { antialias: false },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    const send = () => {
      game.events.emit('setEngine', engineRef.current);
      game.events.emit('setUserId', userId);
      game.events.emit('setUsername', username);
    };

    // Scene may not be ready yet — wait for it
    game.events.once('ready', send);
    // Also try immediately in case ready already fired
    setTimeout(send, 100);

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [phase]);

  // Forward state updates into Phaser
  useEffect(() => {
    if (gameState && gameRef.current) {
      gameRef.current.events.emit('stateUpdate', gameState);
    }
  }, [gameState]);

  // Cleanup engine on unmount
  useEffect(() => () => { engineRef.current?.disconnect(); }, []);

  async function startEngine() {
    const engine = new GameEngine();
    engine.onStateUpdate = setGameState;
    engineRef.current = engine;
    await engine.connect();
    return engine;
  }

  async function handleCreate() {
    setConnectError('');
    setPhase('connecting');
    try {
      const engine = await startEngine();
      const code = await engine.createSession(username, heroClass);
      setSessionCode(code);
      setPhase('playing');
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Connection failed.');
      setPhase('hero-select');
    }
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code) { setJoinError('Enter a session code.'); return; }
    setJoinError(''); setConnectError('');
    setPhase('connecting');
    try {
      const engine = await startEngine();
      const ok = await engine.joinSession(code, username, heroClass);
      if (!ok) { setJoinError('Session not found or full.'); setPhase('hero-select'); return; }
      setSessionCode(code);
      setPhase('playing');
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Connection failed.');
      setPhase('hero-select');
    }
  }

  function handleLeave() {
    engineRef.current?.disconnect();
    engineRef.current = null;
    setGameState(null);
    setSessionCode('');
    setPhase('hero-select');
  }

  // ── Playing phase ─────────────────────────────────────────────────────────
  if (phase === 'playing') {
    const state = gameState;
    const me = state?.players.find(p => p.userId === userId);
    const others = state?.players.filter(p => p.userId !== userId) ?? [];
    const room = state?.currentRoom;
    const cleared = room?.isCleared ?? false;
    const isOver = state?.isGameOver ?? false;
    const isWin = state?.isVictory ?? false;

    return (
      <div style={{ width: '100vw', height: '100vh', background: BG, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: 'rgba(0,0,0,0.7)', borderBottom: `1px solid ${GOLD_DIM}`, fontFamily: F, fontSize: 11, color: GOLD, zIndex: 10 }}>
          <span>
            {state && (
              <>
                <span style={{ color: room?.type === 'Boss' ? RED : room?.type === 'Elite' ? '#f39c12' : GOLD }}>
                  {room?.type === 'Boss' ? '☠ BOSS' : room?.type === 'Elite' ? '★ ELITE' : '○ NORMAL'}
                </span>
                <span style={{ color: GRAY, marginLeft: 8 }}>Room {(state.currentRoomIndex + 1)}/{state.totalRooms}</span>
              </>
            )}
          </span>
          <span style={{ color: GRAY }}>Code: <span style={{ color: WHITE }}>{sessionCode}</span></span>
          <button onClick={handleLeave} style={{ background: 'transparent', border: 'none', color: GRAY, fontFamily: F, fontSize: 10, cursor: 'pointer' }}>[Leave]</button>
        </div>

        {/* Phaser canvas container */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }} />

        {/* Bottom HUD */}
        <div style={{ flexShrink: 0, background: 'rgba(0,0,0,0.75)', borderTop: `1px solid ${GOLD_DIM}`, padding: '6px 12px', zIndex: 10, fontFamily: F }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

            {/* Party stats */}
            {me && <PlayerHud p={me} isMe />}
            {others.map(p => <PlayerHud key={p.userId} p={p} isMe={false} />)}

            {/* Controls hint */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 8, borderLeft: `1px solid rgba(255,255,255,0.07)` }}>
              <span style={{ fontSize: 9, color: GRAY }}>
                <kbd style={{ color: WHITE }}>WASD</kbd> Move &nbsp;
                <kbd style={{ color: WHITE }}>SPACE</kbd> Attack (range: 120px) &nbsp;
                <kbd style={{ color: WHITE }}>Q</kbd> {me?.abilityName ?? 'Ability'}
                {me && !me.canUseAbility && <span style={{ color: GRAY }}> (not ready)</span>}
              </span>

              {/* Ability status */}
              {me && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => engineRef.current?.useAbility()}
                    disabled={!me.canUseAbility || !me.isAlive}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${me.canUseAbility ? resourceColor(me.resourceName) : GRAY}`,
                      color: me.canUseAbility ? resourceColor(me.resourceName) : GRAY,
                      fontFamily: F, fontSize: 9, letterSpacing: '0.06em',
                      padding: '2px 8px', cursor: me.canUseAbility ? 'pointer' : 'not-allowed',
                    }}
                  >✦ {me.abilityName}</button>
                </div>
              )}
            </div>

            {/* Advance / end-state buttons */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {isWin && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#f1c40f', fontSize: 12, letterSpacing: '0.1em' }}>★ VICTORY ★</span>
                  <button onClick={handleLeave} style={advBtn('#f1c40f')}>Return Home</button>
                </div>
              )}
              {isOver && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: RED, fontSize: 12, letterSpacing: '0.1em' }}>☠ DEFEATED</span>
                  <button onClick={handleLeave} style={advBtn(RED)}>Return Home</button>
                </div>
              )}
              {!isWin && !isOver && cleared && (
                <button onClick={() => engineRef.current?.moveToNextRoom()} style={advBtn('#27ae60')}>
                  {state && state.currentRoomIndex >= state.totalRooms - 1 ? '★ Claim Victory' : '→ Next Room'}
                </button>
              )}
              {!isWin && !isOver && !cleared && room && (
                <span style={{ fontSize: 9, color: GRAY }}>
                  {room.enemies.filter(e => e.isAlive).length} enemies remaining
                </span>
              )}
            </div>

          </div>

          {/* Combat log */}
          {state && state.log.length > 0 && (
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {state.log.slice(-4).map((line, i) => (
                <div key={i} style={{ fontSize: 9, color: line.startsWith('»') ? GOLD : line.includes('defeated') || line.includes('fallen') || line.includes('wiped') ? RED : '#aaaaaa', paddingLeft: line.startsWith('»') ? 0 : 8 }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Connecting ────────────────────────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: GOLD, fontFamily: F, letterSpacing: '0.12em', fontSize: '0.85rem' }}>Entering the dungeon...</p>
      </div>
    );
  }

  // ── Hero select ───────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: BG, color: GOLD, fontFamily: F, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1rem', letterSpacing: '0.25em', textTransform: 'uppercase', margin: '0 0 0.3rem' }}>Heroes Descent</h1>
      <p style={{ color: GOLD_DIM, fontSize: '0.7rem', letterSpacing: '0.15em', margin: '0 0 2rem' }}>Choose your class</p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {(Object.keys(HERO_INFO) as HeroClass[]).map(cls => {
          const h = HERO_INFO[cls];
          const sel = heroClass === cls;
          return (
            <button key={cls} onClick={() => setHeroClass(cls)} style={{
              background: sel ? 'rgba(201,168,76,0.1)' : 'transparent',
              border: `1px solid ${sel ? GOLD : GOLD_DIM}`,
              color: sel ? GOLD : GOLD_DIM,
              fontFamily: F, padding: '1.1rem 1.3rem', cursor: 'pointer',
              textAlign: 'left', minWidth: 170, borderRadius: 3,
            }}>
              <div style={{ fontSize: '1.4rem', marginBottom: '0.4rem' }}>{h.icon}</div>
              <div style={{ fontSize: '0.82rem', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{cls}</div>
              <div style={{ fontSize: '0.62rem', lineHeight: 1.8, color: sel ? WHITE : GRAY }}>
                <div>HP {h.hp} &nbsp; ATK {h.atk} &nbsp; DEF {h.def} &nbsp; SPD {h.spd}</div>
                <div style={{ color: sel ? GOLD : GRAY, marginTop: 2 }}>✦ {h.ability}</div>
                <div style={{ color: sel ? GOLD_DIM : GRAY, marginTop: 2, maxWidth: 160 }}>{h.tip}</div>
              </div>
            </button>
          );
        })}
      </div>

      {connectError && <p style={{ color: RED, fontSize: '0.7rem', marginBottom: '0.8rem' }}>{connectError}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', alignItems: 'center', width: '100%', maxWidth: 380 }}>
        <button onClick={handleCreate} style={{ width: '100%', background: 'rgba(201,168,76,0.1)', border: `1px solid ${GOLD}`, color: GOLD, fontFamily: F, fontSize: '0.78rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: '0.65rem', cursor: 'pointer' }}>
          ▶ Create Dungeon
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
          <div style={{ flex: 1, height: 1, background: GOLD_DIM }} />
          <span style={{ color: GOLD_DIM, fontSize: '0.62rem', letterSpacing: '0.1em' }}>or join</span>
          <div style={{ flex: 1, height: 1, background: GOLD_DIM }} />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
          <input
            placeholder="Session code (e.g. AB3K9Z)"
            value={joinCode}
            onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(''); }}
            maxLength={6}
            style={{ flex: 1, background: 'transparent', border: `1px solid ${joinError ? RED : GOLD_DIM}`, color: WHITE, fontFamily: F, fontSize: '0.78rem', padding: '0.5rem 0.6rem', letterSpacing: '0.1em', outline: 'none', textTransform: 'uppercase' }}
          />
          <button onClick={handleJoin} style={{ background: 'transparent', border: `1px solid ${GOLD_DIM}`, color: GOLD, fontFamily: F, fontSize: '0.72rem', letterSpacing: '0.1em', padding: '0.5rem 1rem', cursor: 'pointer' }}>Join</button>
        </div>
        {joinError && <p style={{ color: RED, fontSize: '0.62rem', margin: 0 }}>{joinError}</p>}

        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: GRAY, fontFamily: F, fontSize: '0.62rem', cursor: 'pointer', letterSpacing: '0.08em', marginTop: 4 }}>← Back to Home</button>
      </div>
    </div>
  );
}

function advBtn(color: string): React.CSSProperties {
  return {
    background: 'transparent', border: `1px solid ${color}`, color,
    fontFamily: F, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '4px 12px', cursor: 'pointer',
  };
}
