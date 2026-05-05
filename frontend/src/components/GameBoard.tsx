// GameBoard.tsx — the main React UI wrapper rendered during an active dungeon run.
//
// Responsibilities:
//   - Header bar: floor label, room type badge, room counter, session code, leave button.
//   - Left panel: enemy list with health bars and per-enemy attack buttons;
//     replaced by a treasure chest panel when the current room is a TreasureChest.
//   - Right panel: scrolling combat log fed from server-pushed state.
//   - Bottom panel: one PlayerCard per party member showing HP, resource bar,
//     gold balance, and (for the local player) the ability button.
//   - End states: full-screen VICTORY and DEFEATED overlays.
//
// This component does NOT own game state — it receives a GameState snapshot as a
// prop on every server broadcast and re-renders from that. All actions (attack,
// ability, move room) are forwarded to the GameEngine which calls the SignalR hub.

import { useRef, useEffect, useState } from 'react';
import type { GameState, PlayerState } from '../types/gameTypes';
import type { GameEngine } from '../game/gameEngine';

const C = {
  bg: '#07070d',
  gold: '#c9a84c',
  goldDim: 'rgba(201,168,76,0.4)',
  goldFaint: 'rgba(201,168,76,0.08)',
  red: '#c0392b',
  redDim: 'rgba(192,57,43,0.3)',
  blue: '#2980b9',
  orange: '#e67e22',
  green: '#27ae60',
  yellow: '#f1c40f',
  white: '#e8e8e8',
  gray: '#555',
  font: "'Courier New', Courier, monospace",
} as const;

function bar(val: number, max: number, color: string) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
    </div>
  );
}

function resourceColor(name: string) {
  if (name === 'Mana')   return C.blue;
  if (name === 'Rage')   return C.orange;
  if (name === 'Energy') return C.yellow;
  return C.gold;
}

function classIcon(cls: string) {
  if (cls === 'Warrior') return '⚔';
  if (cls === 'Wizard')  return '🔥';
  if (cls === 'Archer')  return '🏹';
  return '?';
}

function roomLabel(type: string) {
  if (type === 'Boss')          return '☠ BOSS';
  if (type === 'Elite')         return '★ ELITE';
  if (type === 'TreasureChest') return '✦ TREASURE';
  return '○ NORMAL';
}

function roomLabelColor(type: string) {
  if (type === 'Boss')          return '#e74c3c';
  if (type === 'Elite')         return '#f39c12';
  if (type === 'TreasureChest') return C.gold;
  return C.goldDim;
}

// ── PlayerCard ────────────────────────────────────────────────────────────────

function PlayerCard({
  player, isMe, onAbility,
}: {
  player: PlayerState;
  isMe: boolean;
  onAbility: () => void;
}) {
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const onCooldown = cooldownRemaining > 0;

  function handleAbility() {
    if (!player.canUseAbility) return;
    onAbility();
  }

  const resColor = resourceColor(player.resourceName);

  return (
    <div style={{
      padding: '0.6rem 0.8rem',
      background: isMe ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isMe ? C.goldDim : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 3,
      marginBottom: '0.4rem',
      opacity: player.isAlive ? 1 : 0.4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1rem' }}>{classIcon(player.heroClass)}</span>
        <span style={{ color: isMe ? C.gold : C.white, fontFamily: C.font, fontSize: '0.75rem', letterSpacing: '0.08em' }}>
          {player.username} — {player.heroClass}
          {!player.isAlive && <span style={{ color: C.red, marginLeft: '0.4rem' }}>DEAD</span>}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{ color: C.red, fontFamily: C.font, fontSize: '0.65rem', width: 20 }}>HP</span>
        {bar(player.currentHp, player.maxHp, C.red)}
        <span style={{ color: C.white, fontFamily: C.font, fontSize: '0.65rem', width: 60, textAlign: 'right' }}>
          {player.currentHp}/{player.maxHp}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{ color: resColor, fontFamily: C.font, fontSize: '0.65rem', width: 20 }}>
          {player.resourceName.slice(0, 2)}
        </span>
        {bar(player.resource, player.maxResource, resColor)}
        <span style={{ color: C.white, fontFamily: C.font, fontSize: '0.65rem', width: 60, textAlign: 'right' }}>
          {player.resource}/{player.maxResource}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: isMe ? '0.5rem' : 0 }}>
        <span style={{ color: C.gold, fontFamily: C.font, fontSize: '0.65rem' }}>✦ {player.gold}g</span>
      </div>

      {isMe && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={handleAbility}
            disabled={!player.isAlive || !player.canUseAbility}
            style={{
              background: 'transparent',
              border: `1px solid ${player.canUseAbility && player.isAlive ? resColor : C.gray}`,
              color: player.canUseAbility && player.isAlive ? resColor : C.gray,
              fontFamily: C.font,
              fontSize: '0.65rem',
              letterSpacing: '0.08em',
              padding: '0.3rem 0.7rem',
              cursor: player.canUseAbility && player.isAlive ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
            }}
          >
            ✦ {player.abilityName}
          </button>
          {onCooldown && (
            <span style={{ color: C.gray, fontFamily: C.font, fontSize: '0.6rem' }}>
              atk ready in {(cooldownRemaining / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── GameBoard ─────────────────────────────────────────────────────────────────

interface Props {
  state: GameState;
  userId: string;
  engine: GameEngine;
  sessionCode: string;
  onLeave: () => void;
}

export default function GameBoard({ state, userId, engine, sessionCode, onLeave }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const attackCooldownUntilRef = useRef<Record<string, number>>({});
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.log]);

  const me = state.players.find(p => p.userId === userId);
  const others = state.players.filter(p => p.userId !== userId);

  function handleAttack(enemyId: string) {
    const now = Date.now();
    const until = attackCooldownUntilRef.current[userId] ?? 0;
    if (now < until) return;
    attackCooldownUntilRef.current[userId] = now + (me?.attackCooldownMs ?? 2000);
    engine.attackEnemy(enemyId);
    tick(n => n + 1);
  }

  function handleAbility() {
    engine.useAbility();
  }

  const now = Date.now();
  const attackCooldownRemaining = Math.max(0, (attackCooldownUntilRef.current[userId] ?? 0) - now);
  const onAttackCooldown = attackCooldownRemaining > 0;
  const room = state.currentRoom;

  // ── End states ──
  if (state.isVictory) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.gold, fontFamily: C.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
        <div style={{ fontSize: '2rem', letterSpacing: '0.15em' }}>★ VICTORY ★</div>
        <p style={{ color: C.white, letterSpacing: '0.08em' }}>The dungeon has been conquered!</p>
        <button onClick={onLeave} style={btnStyle(C.gold)}>← Return Home</button>
      </div>
    );
  }

  if (state.isGameOver) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.red, fontFamily: C.font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
        <div style={{ fontSize: '2rem', letterSpacing: '0.15em' }}>☠ DEFEATED</div>
        <p style={{ color: C.white, letterSpacing: '0.08em' }}>The darkness claims you...</p>
        <button onClick={onLeave} style={btnStyle(C.red)}>← Return Home</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.gold, fontFamily: C.font, display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1.2rem', borderBottom: `1px solid ${C.goldDim}` }}>
        <span style={{ fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Heroes Descent — Floor 1
        </span>
        <span style={{ fontSize: '0.75rem', letterSpacing: '0.1em' }}>
          <span style={{ color: roomLabelColor(room.type) }}>{roomLabel(room.type)}</span>
          <span style={{ color: C.gray, marginLeft: '0.8rem' }}>
            Room {state.currentRoomIndex + 1}/{state.totalRooms}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: C.gray, fontSize: '0.65rem' }}>Code: <span style={{ color: C.white }}>{sessionCode}</span></span>
          <button onClick={onLeave} style={{ background: 'transparent', border: 'none', color: C.gray, fontFamily: C.font, fontSize: '0.65rem', cursor: 'pointer', letterSpacing: '0.08em' }}>
            [Leave]
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, minHeight: 0 }}>

        {/* Left: enemies + advance */}
        <div style={{ padding: '1rem 1.2rem', borderRight: `1px solid ${C.goldDim}`, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.goldDim }}>
            » {room.type === 'TreasureChest' ? 'Treasure' : 'Enemies'}
          </h3>

          {room.type === 'TreasureChest' ? (
            <div style={{
              padding: '1.2rem',
              border: `1px solid ${C.goldDim}`,
              background: 'rgba(201,168,76,0.06)',
              borderRadius: 3,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📦</div>
              <p style={{ color: C.gold, fontFamily: C.font, fontSize: '0.75rem', margin: 0, letterSpacing: '0.08em' }}>
                Treasure Chest
              </p>
              <p style={{ color: C.white, fontFamily: C.font, fontSize: '0.65rem', margin: '0.4rem 0 0', opacity: 0.7 }}>
                Gold coins were distributed to the party!
              </p>
            </div>
          ) : room.enemies.length === 0 ? (
            <p style={{ color: C.gray, fontSize: '0.75rem' }}>No enemies.</p>
          ) : (
            room.enemies.map(e => (
              <div key={e.id} style={{
                padding: '0.7rem 0.9rem',
                border: `1px solid ${e.isAlive ? (room.type === 'Boss' ? 'rgba(231,76,60,0.5)' : C.goldDim) : 'rgba(255,255,255,0.05)'}`,
                background: e.isAlive ? C.goldFaint : 'transparent',
                borderRadius: 3,
                opacity: e.isAlive ? 1 : 0.3,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.8rem', color: e.isAlive ? C.white : C.gray, letterSpacing: '0.05em' }}>
                    {room.type === 'Boss' ? '☠ ' : ''}{e.name}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: C.gray }}>
                    {e.isAlive ? `${e.health}/${e.maxHealth}` : '✗ Slain'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {bar(e.health, e.maxHealth, e.isAlive ? C.red : C.gray)}
                  {e.isAlive && me?.isAlive && (
                    <button
                      onClick={() => handleAttack(e.id)}
                      disabled={onAttackCooldown}
                      style={{
                        background: onAttackCooldown ? 'transparent' : C.red,
                        border: `1px solid ${onAttackCooldown ? C.gray : C.red}`,
                        color: onAttackCooldown ? C.gray : C.white,
                        fontFamily: C.font,
                        fontSize: '0.6rem',
                        letterSpacing: '0.08em',
                        padding: '0.25rem 0.6rem',
                        cursor: onAttackCooldown ? 'not-allowed' : 'pointer',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        minWidth: 64,
                      }}
                    >
                      {onAttackCooldown ? `${(attackCooldownRemaining / 1000).toFixed(1)}s` : '⚔ Attack'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          <div style={{ marginTop: 'auto' }}>
            <button
              onClick={() => engine.moveToNextRoom()}
              disabled={!room.isCleared}
              style={{
                width: '100%',
                background: room.isCleared ? 'rgba(39,174,96,0.15)' : 'transparent',
                border: `1px solid ${room.isCleared ? C.green : C.gray}`,
                color: room.isCleared ? C.green : C.gray,
                fontFamily: C.font,
                fontSize: '0.7rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '0.6rem',
                cursor: room.isCleared ? 'pointer' : 'not-allowed',
              }}
            >
              {room.isCleared
                ? (state.currentRoomIndex >= state.totalRooms - 1 ? '★ Claim Victory' : '→ Advance to Next Room')
                : `Clear Room to Advance (${room.enemies.filter(e => e.isAlive).length} remaining)`}
            </button>
          </div>
        </div>

        {/* Right: combat log */}
        <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: C.goldDim }}>
            » Combat Log
          </h3>
          <div
            ref={logRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              fontFamily: C.font,
              fontSize: '0.72rem',
              lineHeight: '1.7',
              color: C.white,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.1rem',
            }}
          >
            {state.log.map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('»') ? C.gold
                  : line.includes('VICTORY') ? C.green
                  : line.includes('defeated') || line.includes('slain') || line.includes('fallen') ? C.red
                  : C.white,
                paddingLeft: line.startsWith('»') ? 0 : '0.5rem',
              }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom: player stats */}
      <div style={{ borderTop: `1px solid ${C.goldDim}`, padding: '0.8rem 1.2rem' }}>
        <div style={{ fontSize: '0.65rem', color: C.goldDim, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
          » Party
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.5rem' }}>
          {me && <PlayerCard player={me} isMe onAbility={handleAbility} />}
          {others.map(p => (
            <PlayerCard key={p.userId} player={p} isMe={false} onAbility={() => {}} />
          ))}
        </div>
      </div>

    </div>
  );
}

function btnStyle(color: string) {
  return {
    background: 'transparent',
    border: `1px solid ${color}`,
    color,
    fontFamily: "'Courier New', Courier, monospace" as const,
    fontSize: '0.75rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    padding: '0.5rem 1.2rem',
    cursor: 'pointer',
  };
}
