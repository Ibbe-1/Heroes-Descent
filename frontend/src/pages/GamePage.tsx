// GamePage.tsx — the main React component that manages the entire game flow.
//
// It has three phases:
//   'hero-select'  → the player picks a class and creates or joins a session.
//   'connecting'   → the SignalR WebSocket is being established.
//   'playing'      → the Phaser canvas is mounted alongside the React HUD overlay.
//
// React is responsible for:
//   - The hero select screen (class cards, buttons, join input).
//   - The HUD overlay (party stats, combat log, ability button, advance button).
//   - Owning the SignalR connection via GameEngine.
//
// Phaser is responsible for:
//   - Rendering the dungeon room, sprites, HP bars, and animations.
//   - Reading WASD/SPACE/Q input at 60fps and sending position to the server.
//
// The two systems communicate through the Phaser event bus:
//   React → Phaser: gameRef.current.events.emit('stateUpdate', state)
//   Phaser → React: nothing — Phaser only reads from the bus, never writes back to React.

import { useState, useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../game/GameScene';
import { GameEngine } from '../game/gameEngine';
import type { GameState, HeroClass, PlayerState } from '../types/gameTypes';

// Shared style constants so we don't repeat hex strings everywhere.
const F = "'Courier New', Courier, monospace";
const GOLD = '#c9a84c';
const GOLD_DIM = 'rgba(201,168,76,0.4)';
const BG = '#07070d';
const RED = '#c0392b';
const GRAY = '#555';
const WHITE = '#e8e8e8';

// Static hero stats displayed on the hero selection cards.
// These mirror the values the server uses but are only for display — the server
// is the authoritative source for all in-game numbers.
const HERO_INFO: Record<HeroClass, { icon: string; hp: number; atk: number; def: number; spd: number; ability: string; tip: string }> = {
  Warrior: { icon: '⚔', hp: 120, atk: 25, def: 10, spd: 7,  ability: 'Shield Block', tip: 'Next hit halved. Gains Rage on damage.' },
  Wizard:  { icon: '🔥', hp: 60,  atk: 10, def: 3,  spd: 10, ability: 'Fireball',    tip: 'Blasts all enemies in the room.' },
  Archer:  { icon: '🏹', hp: 85,  atk: 18, def: 6,  spd: 14, ability: 'Multi-Shot',  tip: 'Fires at 2 targets. High crit chance.' },
};

// Each hero class uses a different resource bar color so players can recognize
// them at a glance without reading the label.
function resourceColor(name: string) {
  if (name === 'Mana') return '#2980b9';
  if (name === 'Rage') return '#e67e22';
  return '#27ae60';  // Energy (Archer)
}

// ── Reusable sub-components ───────────────────────────────────────────────────

// A thin colored progress bar used for both HP and resource displays.
// val/max are numbers; color is a CSS color string.
function MiniBar({ val, max, color }: { val: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
    </div>
  );
}

// One card in the bottom party bar showing a single player's status.
// isMe highlights the local player's card in gold so it stands out.
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
      opacity: p.isAlive ? 1 : 0.4,  // dim dead players
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

// ── Main component ────────────────────────────────────────────────────────────

type Phase = 'hero-select' | 'connecting' | 'playing';

interface Props { username: string; userId: string; onBack: () => void; }

export default function GamePage({ username, userId, onBack }: Props) {
  const [phase, setPhase]             = useState<Phase>('hero-select');
  const [heroClass, setHeroClass]     = useState<HeroClass>('Warrior');
  const [joinCode, setJoinCode]       = useState('');
  const [joinError, setJoinError]     = useState('');
  const [connectError, setConnectError] = useState('');
  const [sessionCode, setSessionCode] = useState('');

  // gameState is set by GameEngine.onStateUpdate every time the server pushes
  // a new GameStateUpdate message. React re-renders the HUD with the new data,
  // and a separate useEffect forwards the state into the Phaser scene.
  const [gameState, setGameState]     = useState<GameState | null>(null);

  // Refs hold the Phaser game instance and the SignalR engine so they persist
  // across re-renders without triggering extra effects.
  const containerRef    = useRef<HTMLDivElement>(null);
  const gameRef         = useRef<Phaser.Game | null>(null);
  const engineRef       = useRef<GameEngine | null>(null);
  // Always holds the latest gameState so we can replay it after Phaser finishes loading.
  const latestStateRef  = useRef<GameState | null>(null);

  // Keep latestStateRef in sync with gameState on every render.
  latestStateRef.current = gameState;

  // ── Effect: mount Phaser when entering the 'playing' phase ───────────────

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

    // GameScene emits 'sceneReady' at the very end of create(), after registering
    // all its event listeners.  We wait for that signal so our emits are never
    // dropped into a void.  heroClass is sent explicitly so the sprite is visible
    // from the first update() tick — no dependency on server state timing.
    game.events.once('sceneReady', () => {
      game.events.emit('setEngine',    engineRef.current);
      game.events.emit('setUserId',    userId);
      game.events.emit('setUsername',  username);
      game.events.emit('setHeroClass', heroClass);
      if (latestStateRef.current) {
        game.events.emit('stateUpdate', latestStateRef.current);
      }
    });

    // Destroy the Phaser game when the component unmounts or phase changes away.
    // true = also remove the <canvas> element from the DOM.
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [phase]);

  // ── Effect: forward server state into Phaser ──────────────────────────────

  // Whenever React receives a new GameState from the server, push it into Phaser
  // via the event bus. Phaser's applyState() will sync all sprites accordingly.
  useEffect(() => {
    if (gameState && gameRef.current) {
      gameRef.current.events.emit('stateUpdate', gameState);
    }
  }, [gameState]);

  // Disconnect SignalR when the component is removed from the React tree.
  useEffect(() => () => { engineRef.current?.disconnect(); }, []);

  // ── Session management helpers ────────────────────────────────────────────

  // Creates a new GameEngine, sets the state-update callback, and opens the
  // WebSocket connection. Awaited before calling createSession / joinSession.
  async function startEngine() {
    const engine = new GameEngine();
    engine.onStateUpdate = setGameState;  // wire state updates to React state
    engineRef.current = engine;
    await engine.connect();
    return engine;
  }

  // Called when the player clicks "Create Dungeon".
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

  // Called when the player clicks "Join" with a 6-char session code.
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

  // Disconnects SignalR and returns to the hero select screen.
  function handleLeave() {
    engineRef.current?.disconnect();
    engineRef.current = null;
    setGameState(null);
    setSessionCode('');
    setPhase('hero-select');
  }

  // ── Playing phase ─────────────────────────────────────────────────────────

  // When playing, the layout is:
  //   [Top bar]   — room info, session code, leave button
  //   [Phaser canvas]
  //   [Bottom HUD] — party cards, controls hint, ability button, log
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

        {/* Top bar: shows current room type/number, the 6-char code for friends to join, and a leave button. */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: 'rgba(0,0,0,0.7)', borderBottom: `1px solid ${GOLD_DIM}`, fontFamily: F, fontSize: 11, color: GOLD, zIndex: 10 }}>
          <span>
            {state && (
              <>
                {/* Color-coded room type label */}
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

        {/* Phaser canvas mounts here. flex: 1 lets it expand to fill the space between
            the top and bottom bars. minHeight: 0 prevents flexbox overflow. */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }} />

        {/* Bottom HUD overlay — lives above the canvas via zIndex. */}
        <div style={{ flexShrink: 0, background: 'rgba(0,0,0,0.75)', borderTop: `1px solid ${GOLD_DIM}`, padding: '6px 12px', zIndex: 10, fontFamily: F }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

            {/* Party status cards — one per player in the session. */}
            {me && <PlayerHud p={me} isMe />}
            {others.map(p => <PlayerHud key={p.userId} p={p} isMe={false} />)}

            {/* Controls hint and ability button */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 8, borderLeft: `1px solid rgba(255,255,255,0.07)` }}>
              <span style={{ fontSize: 9, color: GRAY }}>
                <kbd style={{ color: WHITE }}>WASD</kbd> Move &nbsp;
                <kbd style={{ color: WHITE }}>Mouse</kbd> Aim &nbsp;
                <kbd style={{ color: WHITE }}>SPACE</kbd> Attack &nbsp;
                <kbd style={{ color: WHITE }}>Q</kbd> {me?.abilityName ?? 'Ability'}
                {me && !me.canUseAbility && <span style={{ color: GRAY }}> (not ready)</span>}
              </span>

              {/* Clickable ability button — mirrors the Q key for mouse users.
                  Disabled when the hero's resource is too low (canUseAbility = false). */}
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

            {/* Right side: advance/end-state buttons.
                Only one of these is visible at a time:
                  Victory  → shown when isVictory is true
                  Defeated → shown when isGameOver is true
                  Next Room → shown when the current room is cleared but game isn't over
                  "X enemies remaining" → shown while the room is still active */}
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

          {/* Combat log: last 4 lines from the server's RecentLog list.
              Lines starting with '»' are room announcements (gold).
              Lines mentioning defeat keywords are red. Everything else is grey. */}
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

  // ── Connecting phase ──────────────────────────────────────────────────────

  // Simple loading screen shown while the SignalR handshake completes.
  if (phase === 'connecting') {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: GOLD, fontFamily: F, letterSpacing: '0.12em', fontSize: '0.85rem' }}>Entering the dungeon...</p>
      </div>
    );
  }

  // ── Hero select phase ─────────────────────────────────────────────────────

  // Three clickable class cards + "Create Dungeon" / "Join" buttons.
  // The selected card is highlighted in gold; the others are dim.
  return (
    <div style={{ minHeight: '100vh', background: BG, color: GOLD, fontFamily: F, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1rem', letterSpacing: '0.25em', textTransform: 'uppercase', margin: '0 0 0.3rem' }}>Heroes Descent</h1>
      <p style={{ color: GOLD_DIM, fontSize: '0.7rem', letterSpacing: '0.15em', margin: '0 0 2rem' }}>Choose your class</p>

      {/* Hero class cards */}
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

      {/* Create / join actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', alignItems: 'center', width: '100%', maxWidth: 380 }}>
        <button onClick={handleCreate} style={{ width: '100%', background: 'rgba(201,168,76,0.1)', border: `1px solid ${GOLD}`, color: GOLD, fontFamily: F, fontSize: '0.78rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: '0.65rem', cursor: 'pointer' }}>
          ▶ Create Dungeon
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
          <div style={{ flex: 1, height: 1, background: GOLD_DIM }} />
          <span style={{ color: GOLD_DIM, fontSize: '0.62rem', letterSpacing: '0.1em' }}>or join</span>
          <div style={{ flex: 1, height: 1, background: GOLD_DIM }} />
        </div>

        {/* Join by session code — automatically uppercased so capitalisation doesn't matter. */}
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

// Returns a CSS style object for the advance/end-state buttons (Next Room, Victory, Defeated).
// Extracted as a function so each button can pass its own color without duplicating styles.
function advBtn(color: string): React.CSSProperties {
  return {
    background: 'transparent', border: `1px solid ${color}`, color,
    fontFamily: F, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '4px 12px', cursor: 'pointer',
  };
}
