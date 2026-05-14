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
import type { GameState, HeroClass } from '../types/gameTypes';

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
  Warrior: { icon: '⚔', hp: 120, atk: 25, def: 10, spd: 7,  ability: 'Undying Rage', tip: 'Untargetable for 5 s. Gains Rage on damage.' },
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

function resourceColorRgba(name: string, alpha: number) {
  if (name === 'Mana') return `rgba(41,128,185,${alpha})`;
  if (name === 'Rage') return `rgba(230,126,34,${alpha})`;
  return `rgba(39,174,96,${alpha})`;
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
  const [claimedChestOpen, setClaimedChestOpen] = useState(false);
  // When isVictory first becomes true the overlay appears. "Continue Roaming"
  // dismisses it so players can explore the Exit Hall before leaving.
  const [showVictoryOverlay, setShowVictoryOverlay] = useState(true);

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
      render: { antialias: false, roundPixels: true },
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

    // Fired by GameScene when a player who already claimed clicks the chest again.
    game.events.on('viewClaimedChest', () => setClaimedChestOpen(true));

    // Destroy the Phaser game when the component unmounts or phase changes away.
    // true = also remove the <canvas> element from the DOM.
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [phase]);

  // Close the empty-chest view whenever the party advances to a new room.
  useEffect(() => { setClaimedChestOpen(false); }, [gameState?.currentRoomIndex]);

  // ── Effect: forward server state into Phaser ──────────────────────────────

  // Whenever React receives a new GameState from the server, push it into Phaser
  // via the event bus. Phaser's applyState() will sync all sprites accordingly.
  useEffect(() => {
    if (gameState && gameRef.current) {
      gameRef.current.events.emit('stateUpdate', gameState);
    }
  }, [gameState]);

  // Re-show the victory overlay each time victory is first achieved
  // (handles the case where a player rejoins a won session).
  useEffect(() => {
    if (gameState?.isVictory) setShowVictoryOverlay(true);
  }, [gameState?.isVictory]);

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
    const lootWindowOpen = room?.chestOpenerId === userId;
    const showLootWindow = lootWindowOpen || claimedChestOpen;
    // Players who have already claimed their gold from this chest.
    const claimers = state?.players.filter(p => p.chestClaimed) ?? [];

    return (
      <div style={{ width: '100vw', height: '100vh', background: BG, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar: shows current room type/number, the 6-char code for friends to join, and a leave button. */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: 'rgba(0,0,0,0.7)', borderBottom: `1px solid ${GOLD_DIM}`, fontFamily: F, fontSize: 11, color: GOLD, zIndex: 10 }}>
          <span>
            {state && (
              <>
                {/* Color-coded room type label */}
                <span style={{ color: room?.type === 'Boss' ? RED : room?.type === 'Elite' ? '#f39c12' : GOLD }}>
                  {room?.type === 'Boss' ? '☠ BOSS' : room?.type === 'Elite' ? '★ ELITE' : room?.type === 'TreasureChest' ? '✦ CHEST' : room?.type === 'ExitHall' ? '✦ EXIT HALL' : '○ NORMAL'}
                </span>
                <span style={{ color: GRAY, marginLeft: 8 }}>Room {(state.currentRoomIndex + 1)}/{state.totalRooms}</span>
              </>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {(state?.prestigeRound ?? 1) > 1 && (
              <span style={{
                background: 'rgba(201,168,76,0.18)', border: `1px solid ${GOLD}`,
                color: GOLD, fontSize: 10, letterSpacing: '0.14em',
                padding: '2px 8px', textTransform: 'uppercase',
                boxShadow: '0 0 8px rgba(201,168,76,0.3)',
              }}>
                ▼ PRESTIGE {toRoman(state!.prestigeRound)}
              </span>
            )}
            <span style={{ color: GRAY }}>Code: <span style={{ color: WHITE }}>{sessionCode}</span></span>
          </span>
          <button onClick={handleLeave} style={{ background: 'transparent', border: 'none', color: GRAY, fontFamily: F, fontSize: 10, cursor: 'pointer' }}>[Leave]</button>
        </div>

        {/* Phaser canvas mounts here. flex: 1 lets it expand to fill the space between
            the top and bottom bars. minHeight: 0 prevents flexbox overflow. */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {isWin && showVictoryOverlay && (
            <VictoryStatsOverlay
              players={state?.players ?? []}
              myUserId={userId}
              prestigeRound={state?.prestigeRound ?? 1}
              onContinue={() => setShowVictoryOverlay(false)}
              onDelveDeeper={() => engineRef.current?.delveDeeper()}
              onLeave={handleLeave}
            />
          )}
          {isWin && !showVictoryOverlay && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: '0.75rem', zIndex: 40,
            }}>
              <button onClick={() => engineRef.current?.delveDeeper()} style={{
                background: 'rgba(201,168,76,0.22)', border: `2px solid ${GOLD}`,
                color: GOLD, fontFamily: F, fontSize: '0.72rem',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '0.55rem 1.6rem', cursor: 'pointer',
                boxShadow: `0 0 12px rgba(201,168,76,0.3)`,
              }}>
                ▼ Delve Deeper
              </button>
              <button onClick={() => setShowVictoryOverlay(true)} style={{
                background: 'rgba(0,0,0,0.82)', border: `1px solid ${GOLD}`,
                color: GOLD, fontFamily: F, fontSize: '0.72rem',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '0.55rem 1.4rem', cursor: 'pointer',
              }}>
                ← Battle Stats
              </button>
              <button onClick={handleLeave} style={{
                background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(255,255,255,0.3)',
                color: WHITE, fontFamily: F, fontSize: '0.72rem',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '0.55rem 1.4rem', cursor: 'pointer',
              }}>
                Return Home
              </button>
            </div>
          )}
        </div>

        {/* Bottom HUD — portrait, ability slots, item hotbar, inventory, party mini-portraits, log. */}
        <div style={{
          flexShrink: 0,
          background: 'rgba(0,0,0,0.88)',
          borderTop: `2px solid ${GOLD_DIM}`,
          padding: '8px 14px',
          zIndex: 10,
          fontFamily: F,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 96,
        }}>

          {/* ── Player portrait + ability slots ──────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

            {/* Portrait circle */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: me?.isAlive ? 'rgba(201,168,76,0.1)' : 'rgba(192,57,43,0.08)',
                border: `2px solid ${me?.isAlive ? GOLD : RED}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.8rem', position: 'relative', overflow: 'hidden',
              }}>
                {me ? HERO_INFO[me.heroClass as HeroClass].icon : '?'}
                {me && !me.isAlive && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.65)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: RED, fontSize: 20,
                  }}>☠</div>
                )}
              </div>
              <span style={{
                fontSize: 9, color: me?.isAlive ? GOLD : RED, letterSpacing: '0.04em',
                maxWidth: 64, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {me?.username ?? '—'}
              </span>
              <div style={{ width: 64, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${me ? Math.max(0, (me.currentHp / me.maxHp) * 100) : 0}%`,
                    height: '100%', background: RED, transition: 'width 0.2s', borderRadius: 2,
                  }} />
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${me ? Math.max(0, (me.resource / me.maxResource) * 100) : 0}%`,
                    height: '100%', background: me ? resourceColor(me.resourceName) : GRAY,
                    transition: 'width 0.2s', borderRadius: 2,
                  }} />
                </div>
              </div>
            </div>

            {/* Ability slots */}
            {me && (
              <div style={{ display: 'flex', gap: 8 }}>

                {/* Slot 1: basic attack (SPACE) */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.1rem',
                  }}>
                    {HERO_INFO[me.heroClass as HeroClass].icon}
                  </div>
                  <span style={{ fontSize: 8, color: GRAY, letterSpacing: '0.05em' }}>SPACE</span>
                  <div style={{ width: 46, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1 }}>
                    <div style={{ width: '100%', height: '100%', background: '#666', borderRadius: 1 }} />
                  </div>
                </div>

                {/* Slot 2: Q ability — glows when ready */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <button
                    onClick={() => engineRef.current?.useAbility()}
                    disabled={!me.canUseAbility || !me.isAlive}
                    title={me.abilityName}
                    style={{
                      width: 46, height: 46, borderRadius: '50%',
                      background: me.canUseAbility ? resourceColorRgba(me.resourceName, 0.18) : 'rgba(255,255,255,0.03)',
                      border: `2px solid ${me.canUseAbility ? resourceColor(me.resourceName) : 'rgba(255,255,255,0.12)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1rem', color: me.canUseAbility ? resourceColor(me.resourceName) : GRAY,
                      cursor: me.canUseAbility && me.isAlive ? 'pointer' : 'not-allowed',
                      padding: 0, outline: 'none', fontFamily: F,
                      boxShadow: me.canUseAbility ? `0 0 10px ${resourceColor(me.resourceName)}55` : 'none',
                      transition: 'border-color 0.25s, box-shadow 0.25s, background 0.25s',
                    }}
                  >✦</button>
                  <span style={{ fontSize: 8, color: me.canUseAbility ? resourceColor(me.resourceName) : GRAY, letterSpacing: '0.05em' }}>Q</span>
                  <div style={{ width: 46, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.max(0, (me.resource / me.maxResource) * 100)}%`,
                      height: '100%', background: resourceColor(me.resourceName),
                      transition: 'width 0.2s', borderRadius: 1,
                    }} />
                  </div>
                </div>

              </div>
            )}
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />

          {/* ── Item hotbar (4 slots) ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {[1, 2, 3, 4].map(n => (
              <div key={n} style={{
                width: 52, height: 52,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'flex-end',
                padding: '0 0 3px',
              }}>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.22)' }}>{n}</span>
              </div>
            ))}
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />

          {/* ── Inventory panel ───────────────────────────────────────────────── */}
          <div style={{
            width: 90, height: 70,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 5,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Inventory</span>
            {me && <span style={{ fontSize: 9, color: GOLD }}>✦ {me.gold}g</span>}
          </div>

          {/* ── Other party members (mini portraits) ─────────────────────────── */}
          {others.length > 0 && (
            <>
              <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {others.map(p => (
                  <div key={p.userId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: p.isAlive ? 1 : 0.45 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${p.isAlive ? 'rgba(255,255,255,0.22)' : RED}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.9rem', position: 'relative', overflow: 'hidden',
                    }}>
                      {HERO_INFO[p.heroClass as HeroClass]?.icon}
                      {!p.isAlive && (
                        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 12 }}>☠</div>
                      )}
                    </div>
                    <span style={{ fontSize: 7, color: p.isAlive ? WHITE : RED, maxWidth: 40, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                      {p.username}
                    </span>
                    <div style={{ width: 38, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0, (p.currentHp / p.maxHp) * 100)}%`, height: '100%', background: RED, borderRadius: 1 }} />
                      </div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0, (p.resource / p.maxResource) * 100)}%`, height: '100%', background: resourceColor(p.resourceName), borderRadius: 1 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Combat log + room controls (far right) ───────────────────────── */}
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            {state && state.log.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 280 }}>
                {state.log.slice(-4).map((line, i) => (
                  <div key={i} style={{
                    fontSize: 8, textAlign: 'right',
                    color: line.startsWith('»') ? GOLD : line.includes('defeated') || line.includes('fallen') || line.includes('wiped') ? RED : '#888',
                  }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {isOver && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <span style={{ color: RED, fontSize: 10, letterSpacing: '0.1em' }}>☠ DEFEATED</span>
                  <button onClick={handleLeave} style={advBtn(RED)}>Return Home</button>
                </div>
              )}
              {!isWin && !isOver && cleared && (
                <button
                  onClick={() => engineRef.current?.moveToNextRoom()}
                  style={advBtn(room?.type === 'Boss' ? GOLD : '#27ae60')}
                >
                  {room?.type === 'Boss' ? '★ Claim Victory' : '→ Next Room'}
                </button>
              )}
              {!isWin && !isOver && !cleared && room && (
                <span style={{ fontSize: 8, color: GRAY }}>{room.enemies.filter(e => e.isAlive).length} enemies remaining</span>
              )}
            </div>
          </div>

        </div>

        {/* Loot window — two modes:
            - Active (lootWindowOpen): player holds the lock, gold is claimable.
            - View-only (claimedChestOpen): player already claimed, shows greyed-out history. */}
        {showLootWindow && room && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, fontFamily: F,
          }}>
            <div style={{
              background: BG,
              border: `1px solid ${GOLD_DIM}`,
              borderRadius: 4,
              padding: '2rem',
              width: 320,
            }}>
              <div style={{ textAlign: 'center', marginBottom: '1.4rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>📦</div>
                <div style={{ color: claimedChestOpen ? GRAY : GOLD, fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  {claimedChestOpen ? 'Chest Emptied' : 'Chest Opened!'}
                </div>
              </div>

              {claimedChestOpen ? (
                /* View-only: greyed out gold + who already looted it */
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '0.8rem 1rem',
                  border: `1px solid rgba(255,255,255,0.06)`,
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 3,
                  marginBottom: '1.4rem',
                  opacity: 0.45,
                }}>
                  <span style={{ fontSize: '1.3rem' }}>🪙</span>
                  <div>
                    <div style={{ color: GRAY, fontSize: 14, letterSpacing: '0.06em', textDecoration: 'line-through' }}>
                      {room.chestGold} Gold Coins
                    </div>
                    {claimers.length > 0 && (
                      <div style={{ color: GRAY, fontSize: 10, marginTop: 3 }}>
                        Looted by {claimers.map(p => p.username).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Active: clickable gold item */
                <button
                  onClick={() => engineRef.current?.claimChest()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '0.8rem 1rem',
                    border: `1px solid ${GOLD_DIM}`,
                    background: 'rgba(201,168,76,0.06)',
                    borderRadius: 3,
                    marginBottom: '1.4rem',
                    cursor: 'pointer',
                    fontFamily: F,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '1.3rem' }}>🪙</span>
                  <div>
                    <div style={{ color: GOLD, fontSize: 14, letterSpacing: '0.06em' }}>
                      {room.chestGold} Gold Coins
                    </div>
                    <div style={{ color: GRAY, fontSize: 10, marginTop: 3 }}>
                      Click to pick up
                    </div>
                  </div>
                </button>
              )}

              <button
                onClick={() => {
                  if (claimedChestOpen) setClaimedChestOpen(false);
                  else engineRef.current?.closeChest();
                }}
                style={{
                  width: '100%', background: 'transparent',
                  border: `1px solid ${GOLD_DIM}`, color: GOLD,
                  fontFamily: F, fontSize: 10, letterSpacing: '0.12em',
                  textTransform: 'uppercase', padding: '0.5rem', cursor: 'pointer',
                }}
              >
                ✦ Close
              </button>
            </div>
          </div>
        )}
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

// ── VictoryStatsOverlay ───────────────────────────────────────────────────────
// Full-screen post-battle report shown automatically when IsVictory becomes true.
// Shows one column per player (max 3): damage, kills, deaths, gold. Highlights MVP.

interface VictoryStatsProps {
  players:       import('../types/gameTypes').PlayerState[];
  myUserId:      string;
  prestigeRound: number;
  onContinue:     () => void;
  onDelveDeeper:  () => void;
  onLeave:        () => void;
}

// Converts 1–39 to Roman numerals for the prestige round badge.
function toRoman(n: number): string {
  const vals = [10, 9, 5, 4, 1] as const;
  const syms = ['X', 'IX', 'V', 'IV', 'I'] as const;
  let result = '';
  let rem    = n;
  for (let i = 0; i < vals.length; i++) {
    while (rem >= vals[i]) { result += syms[i]; rem -= vals[i]; }
  }
  return result || String(n);
}

function VictoryStatsOverlay({ players, myUserId, prestigeRound, onContinue, onDelveDeeper, onLeave }: VictoryStatsProps) {
  const capped = players.slice(0, 3);

  // MVP = highest damage dealt; ties broken by kill count
  const mvpId = capped.reduce((best, p) => {
    const b = capped.find(x => x.userId === best)!;
    if (p.damageDealt > b.damageDealt) return p.userId;
    if (p.damageDealt === b.damageDealt && p.killCount > b.killCount) return p.userId;
    return best;
  }, capped[0]?.userId ?? '');

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(7,7,13,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1.4rem', fontFamily: F, padding: '1rem',
    }}>
      <div style={{ fontSize: '1.6rem', color: GOLD, letterSpacing: '0.28em', textTransform: 'uppercase' }}>
        ★ Post-Battle Report ★
      </div>

      {/* Prestige round badge — visible directly under the title */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '4px 14px',
        border: `1px solid ${GOLD_DIM}`,
        background: 'rgba(201,168,76,0.08)',
      }}>
        <span style={{ color: GOLD_DIM, fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          Prestige Round
        </span>
        <span style={{ color: GOLD, fontSize: '0.85rem', letterSpacing: '0.1em' }}>
          {toRoman(prestigeRound)}
        </span>
        <span style={{ color: GOLD_DIM, fontSize: '0.6rem', letterSpacing: '0.06em' }}>
          — Cleared
        </span>
      </div>

      <p style={{ color: GRAY, fontSize: '0.62rem', letterSpacing: '0.14em', margin: 0, textTransform: 'uppercase' }}>
        Current Round Statistics
      </p>

      {/* Player columns */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {capped.map(p => {
          const isMvp = p.userId === mvpId && capped.length > 1;
          const isMe  = p.userId === myUserId;
          return (
            <div key={p.userId} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
              padding: '1.2rem 1.4rem',
              background: isMvp ? 'rgba(201,168,76,0.1)' : isMe ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isMvp ? GOLD : isMe ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 2,
              minWidth: 160,
              boxShadow: isMvp ? `0 0 18px rgba(201,168,76,0.25)` : 'none',
              position: 'relative',
            }}>
              {isMvp && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: GOLD, color: BG, fontSize: '0.55rem', letterSpacing: '0.12em',
                  padding: '2px 8px', fontFamily: F, textTransform: 'uppercase', fontWeight: 'bold',
                }}>
                  MVP
                </div>
              )}
              <div style={{ fontSize: '1.6rem' }}>{HERO_INFO[p.heroClass as import('../types/gameTypes').HeroClass]?.icon ?? '?'}</div>
              <div style={{ fontSize: '0.72rem', color: isMe ? GOLD : WHITE, letterSpacing: '0.1em', maxWidth: 130, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.username}{isMe ? ' (you)' : ''}
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)', margin: '0.2rem 0' }} />
              <StatRow label="DMG"    value={p.damageDealt.toLocaleString()} color={isMvp ? GOLD : WHITE} />
              <StatRow label="KILLS"  value={String(p.killCount)}  color={WHITE} />
              <StatRow label="DEATHS" value={String(p.deathCount)} color={p.deathCount === 0 ? '#27ae60' : RED} />
              <StatRow label="GOLD"   value={`✦ ${p.gold}`}        color={GOLD} />
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={onDelveDeeper} style={{
          background: 'rgba(201,168,76,0.18)', border: `2px solid ${GOLD}`,
          color: GOLD, fontFamily: F, fontSize: '0.78rem',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          padding: '0.65rem 1.8rem', cursor: 'pointer',
          boxShadow: `0 0 14px rgba(201,168,76,0.35)`,
        }}>
          ▼ Delve Deeper
        </button>
        <button onClick={onContinue} style={{
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.22)',
          color: WHITE, fontFamily: F, fontSize: '0.72rem',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          padding: '0.6rem 1.4rem', cursor: 'pointer',
        }}>
          Explore Shops
        </button>
        <button onClick={onLeave} style={{
          background: 'rgba(201,168,76,0.12)', border: `1px solid ${GOLD}`,
          color: GOLD, fontFamily: F, fontSize: '0.72rem',
          letterSpacing: '0.15em', textTransform: 'uppercase',
          padding: '0.6rem 1.8rem', cursor: 'pointer',
        }}>
          Return Home
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: '1rem' }}>
      <span style={{ fontSize: '0.6rem', color: GRAY, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: '0.7rem', color, letterSpacing: '0.06em' }}>{value}</span>
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
