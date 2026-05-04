// HomePage.tsx
// The main screen a player sees after logging in.
// Divided into a header, a play button, and a 3-column panel grid.
//
// Panels:
//   Hero              — placeholder character stats (class, HP, XP, gold)
//   Recent Expeditions — placeholder run history (last 3 dungeon attempts)
//   Leaderboard       — placeholder top-5 players by deepest floor reached
//   Achievements      — 5 milestones; first two unlock on account creation
//   Party / Friends   — add friends by username, copy an invite code
//   The Descent Awakens — in-world lore / patch notes
//
// Fixed buttons:
//   ⚙ (bottom-left) — opens SettingsModal
//   ? (bottom-right) — opens HelpModal (how-to-play guide)
//
// Everything marked "placeholder" needs to be wired to a real backend endpoint
// once the game logic is implemented in the C# API.

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { useToast } from '../hooks/useToast';
import type { GameSettings } from '../types/settingsTypes';
import { DEFAULT_SETTINGS, formatKey } from '../types/settingsTypes';
import type { FriendEntry } from '../services/friendService';
import { getFriends, addFriend, removeFriend } from '../services/friendService';
import SettingsModal from './SettingsModal';
import styles from './HomePage.module.css';

// ── Mocked / placeholder data ─────────────────────────────────────────────────
// Replace these with real API calls once the backend endpoints exist.

// Content shown in the ? How-to-Play modal.
const HELP_SECTIONS = [
  {
    title: '// Objective',
    body: 'Descend as deep as possible into a procedurally generated dungeon. Each floor is harder than the last. Reach the final boss and survive — or die trying.',
  },
  {
    title: '// Combat',
    body: 'Turns are taken in order of initiative. Choose to Attack, use a Skill, drink a Potion, or Flee. Enemy stats scale with floor depth. [Not yet implemented]',
  },
  {
    title: '// Progression',
    body: 'Defeating enemies grants XP and gold. Level up to improve your stats. Spend gold at merchants between floors. [Not yet implemented]',
  },
  {
    title: '// Multiplayer',
    body: 'Party up with friends and descend together. Shared XP, shared loot — shared doom. Add companions via the Party panel on the home screen. [Not yet implemented]',
  },
  {
    title: '// Achievements',
    body: 'Milestones are tracked automatically. Unlock them by playing, surviving, and exploring. Check the Achievements panel to see your progress.',
  },
];

interface Achievement {
  id: string;
  icon: string;
  name: string;
  description: string;
  unlocked: boolean;
}

// Hardcoded achievement list. 'add_friend' unlocks dynamically when friends.length > 0.
// Wire the rest to real backend data (e.g. player stats) when combat is implemented.
const BASE_ACHIEVEMENTS: Achievement[] = [
  { id: 'account_created', icon: '📜', name: 'A Name Inscribed',     description: 'Create your hero account.',          unlocked: true  },
  { id: 'first_login',     icon: '⚔️', name: 'The Call Answered',    description: 'Log in for the first time.',          unlocked: true  },
  { id: 'first_game',      icon: '🏰', name: 'Into the Descent',     description: 'Start your first game.',              unlocked: false },
  { id: 'first_win',       icon: '👑', name: 'Champion of the Deep', description: 'Complete a full run.',                unlocked: false },
  { id: 'add_friend',      icon: '🤝', name: 'Not Alone',            description: 'Add your first companion.',           unlocked: false },
];

// Placeholder run history — replace with GET /api/runs or similar.
interface Run { floor: number; cause: string; date: string; }
const RECENT_RUNS: Run[] = [
  { floor: 7, cause: 'Consumed by the darkness',  date: '1 week ago'  },
  { floor: 3, cause: 'Slain by a Goblin Shaman',  date: '2 days ago'  },
  { floor: 1, cause: 'Fell into a pit trap',       date: '5 days ago'  },
];

// Placeholder leaderboard — replace with GET /api/leaderboard or similar.
interface LeaderboardEntry { rank: number; name: string; floor: number; }
const LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: 'ShadowBlade',  floor: 42 },
  { rank: 2, name: 'DarkMage99',   floor: 37 },
  { rank: 3, name: 'IronShield',   floor: 31 },
  { rank: 4, name: 'VoidWalker',   floor: 28 },
  { rank: 5, name: 'CrypticSoul',  floor: 24 },
];

// Placeholder character stats — replace with real player data from the backend.
const CHARACTER = { class: 'Warrior', level: 1, hp: 100, maxHp: 100, xp: 0, xpToNext: 100, gold: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

// Generates a random 4-character invite code shown in the Friends panel.
// The actual party joining logic doesn't exist yet — this is UI-only for now.
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `HERO-${code}`;
}

// Reads settings from localStorage on mount. Falls back to DEFAULT_SETTINGS
// if nothing is stored yet or if the JSON is corrupted.
function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('hd_settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

// ── HelpModal ─────────────────────────────────────────────────────────────────
// Opened by the ? button (bottom-right). Shows a placeholder how-to-play guide.
// Update HELP_SECTIONS above as the real game mechanics are implemented.

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>» How to Play</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          {HELP_SECTIONS.map(s => (
            <div key={s.title} className={styles.helpSection}>
              <p className={styles.helpSectionTitle}>{s.title}</p>
              <p className={styles.helpSectionBody}>{s.body}</p>
            </div>
          ))}
          <p className={styles.helpNote}>
            * Content marked [Not yet implemented] is planned and will be added in a future update.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── HomePage ──────────────────────────────────────────────────────────────────

// FriendEntry is imported from friendService — it matches the shape the API returns.
// Online status comes from the API response (always false until SignalR presence
// is wired up in GameHub.cs).

interface Props { username: string; onLogout: () => void; onPlay: () => void; }

export default function HomePage({ username, onLogout, onPlay }: Props) {
  const [friends, setFriends]           = useState<FriendEntry[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendInput, setFriendInput]   = useState('');
  const [friendError, setFriendError]   = useState('');
  const [helpOpen, setHelpOpen]         = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Invite code is generated once per session — regenerates on page refresh.
  const [inviteCode]                    = useState(generateInviteCode);
  const [settings, setSettings]         = useState<GameSettings>(loadSettings);
  const { toasts, addToast }            = useToast();

  // Typewriter animation for the welcome message.
  // The full string is typed character by character, then we split it into three
  // parts so the username portion can be rendered in a different (white) colour.
  const fullText  = `The hero ${username} has returned`;
  const displayed = useTypewriter(fullText);
  const nameStart = 'The hero '.length;
  const nameEnd   = nameStart + username.length;
  const before    = displayed.slice(0, Math.min(displayed.length, nameStart));
  const namePart  = displayed.length > nameStart ? displayed.slice(nameStart, Math.min(displayed.length, nameEnd)) : '';
  const after     = displayed.length > nameEnd   ? displayed.slice(nameEnd) : '';

  // 'add_friend' achievement unlocks automatically when the first friend is added.
  const achievements = BASE_ACHIEVEMENTS.map(a =>
    a.id === 'add_friend' ? { ...a, unlocked: friends.length > 0 } : a
  );

  // Load the player's friend list from the backend on mount.
  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch(() => { /* leave list empty if the request fails */ })
      .finally(() => setFriendsLoading(false));
  }, []);

  // Persist settings to localStorage whenever they change (triggered by SettingsModal).
  useEffect(() => {
    localStorage.setItem('hd_settings', JSON.stringify(settings));
  }, [settings]);

  // Global keyboard shortcut: press the configured key (default: Enter) to start
  // the game. Disabled while a modal is open or an input field is focused.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (helpOpen || settingsOpen) return;
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === settings.keybinds.enterGame) onPlay();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [helpOpen, settingsOpen, settings.keybinds.enterGame, onPlay]);

  // Calls POST /api/friends, then re-fetches the list on success.
  async function handleAddFriend(e: FormEvent) {
    e.preventDefault();
    const name = friendInput.trim();
    if (!name) return;
    setFriendError('');
    try {
      await addFriend(name);
      const updated = await getFriends();
      setFriends(updated);
      setFriendInput('');
      addToast(`${name} added to your party.`);
    } catch (err) {
      setFriendError(err instanceof Error ? err.message : 'Failed to add friend.');
    }
  }

  // Calls DELETE /api/friends/{username}, then re-fetches the list on success.
  async function handleRemoveFriend(username: string) {
    try {
      await removeFriend(username);
      setFriends(prev => prev.filter(f => f.username !== username));
      addToast(`${username} removed from your party.`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove friend.');
    }
  }

  // Copies the invite code to the clipboard and shows a toast confirmation.
  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      addToast('Invite code copied!');
    } catch {
      addToast('Copy failed — try manually.');
    }
  }

  // useCallback so the reference stays stable and doesn't re-trigger effects in SettingsModal.
  const handleSettingsChange = useCallback((s: GameSettings) => setSettings(s), []);

  return (
    // The noScanlines class removes the CRT ::before overlay when scanlines are off in settings.
    <div className={settings.scanlines ? styles.page : `${styles.page} ${styles.noScanlines}`}>

      {/* ⚙ opens Settings modal (bottom-left), ? opens Help modal (bottom-right) */}
      <button className={styles.settingsBtn} onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button>
      <button className={styles.helpBtn}     onClick={() => setHelpOpen(true)}     aria-label="Help">?</button>

      {helpOpen     && <HelpModal onClose={() => setHelpOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* News ticker */}
      <div className={styles.ticker}>
        <span className={styles.tickerLabel}>⚔ NEWS ⚔</span>
        <div className={styles.tickerTrack}>
          <span className={styles.tickerContent}>
            Welcome to Heroes Descent! &nbsp;|&nbsp; The dungeon stirs from its ancient slumber... &nbsp;|&nbsp; Server is ONLINE &nbsp;|&nbsp; Party up with friends and descend together &nbsp;|&nbsp; New content coming in future updates! &nbsp;|&nbsp; Welcome to Heroes Descent!
          </span>
        </div>
      </div>

      {/* Header — logo banner + welcome info bar */}
      <header className={styles.header}>
        <div className={styles.logoBanner}>
          <img src="/logga.webp" className={styles.logo} alt="Heroes Descent" />
        </div>
        <div className={styles.headerInfo}>
          <p className={styles.welcomeText}>
            {before}
            {namePart && <span className={styles.heroName}>{namePart}</span>}
            {after}
            <span className={styles.cursor}>_</span>
          </p>
          <span className={styles.onlineCount}>
            <span className={styles.onlineDot} />Players online: 1
          </span>
          <button className={styles.logoutBtn} onClick={onLogout}>[ Logout ]</button>
        </div>
      </header>

      {/* Play button + keyboard shortcut hint */}
      <section className={styles.playSection}>
        <button className={styles.playBtn} onClick={onPlay}>
          <span className={styles.playIcon}>▶</span>
          <span className={styles.playLabel}>PLAY</span>
        </button>
        {/* Shows the currently mapped key — updates live if the player remaps it in Settings */}
        <p className={styles.playHint}>
          or press <kbd className={styles.key}>{formatKey(settings.keybinds.enterGame)}</kbd> to descend
        </p>
      </section>

      {/* 3-column panel grid (2-col on medium screens, 1-col on mobile) */}
      <div className={styles.panels}>

        {/* Hero stats — placeholder until the C# player entity is fleshed out */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» Hero</h2>
          <div className={styles.panelBody}>
            <p className={styles.charClass}>{CHARACTER.class} — Lv. {CHARACTER.level}</p>
            <div className={styles.statRows}>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>HP</span>
                <div className={styles.statBar}>
                  <div className={styles.statBarHp} style={{ width: `${(CHARACTER.hp / CHARACTER.maxHp) * 100}%` }} />
                </div>
                <span className={styles.statVal}>{CHARACTER.hp}/{CHARACTER.maxHp}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>XP</span>
                <div className={styles.statBar}>
                  <div className={styles.statBarXp} style={{ width: `${(CHARACTER.xp / CHARACTER.xpToNext) * 100}%` }} />
                </div>
                <span className={styles.statVal}>{CHARACTER.xp}/{CHARACTER.xpToNext}</span>
              </div>
            </div>
            <p className={styles.charGold}>Gold: {CHARACTER.gold} gp</p>
            <p className={styles.panelNote}>[Not yet implemented — placeholder stats]</p>
          </div>
        </div>

        {/* Recent runs — placeholder until run history is saved to the database */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» Recent Expeditions</h2>
          <div className={styles.panelBody}>
            {RECENT_RUNS.length === 0 ? (
              <p className={styles.emptyMsg}>No expeditions recorded yet.</p>
            ) : (
              RECENT_RUNS.map((r, i) => (
                <div key={i} className={styles.runEntry}>
                  <span className={styles.runFloor}>Floor {r.floor}</span>
                  <span className={styles.runCause}>{r.cause}</span>
                  <span className={styles.runDate}>{r.date}</span>
                </div>
              ))
            )}
            <p className={styles.panelNote}>[Not yet implemented — placeholder data]</p>
          </div>
        </div>

        {/* Leaderboard — placeholder until a real ranking endpoint exists */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» Leaderboard</h2>
          <div className={styles.panelBody}>
            {/* The logged-in user's row gets a highlight style if they appear in the list */}
            {LEADERBOARD.map(e => (
              <div key={e.rank} className={e.name === username ? `${styles.lbEntry} ${styles.lbEntryMe}` : styles.lbEntry}>
                <span className={styles.lbRank}>#{e.rank}</span>
                <span className={styles.lbName}>{e.name}</span>
                <span className={styles.lbFloor}>Floor {e.floor}</span>
              </div>
            ))}
            <p className={styles.panelNote}>[Not yet implemented — placeholder data]</p>
          </div>
        </div>

        {/* Achievements — first two are always unlocked; 'add_friend' unlocks dynamically */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» Achievements</h2>
          <div className={styles.panelBody}>
            {achievements.map(a => (
              <div key={a.id} className={styles.achievement}>
                <span className={a.unlocked ? styles.achievementIcon : styles.achievementIconLocked}>
                  {a.icon}
                </span>
                <div>
                  <div className={a.unlocked ? styles.achievementName : styles.achievementNameLocked}>
                    {a.unlocked ? a.name : '???'}
                  </div>
                  <div className={styles.achievementDesc}>
                    {a.unlocked ? a.description : 'Keep playing to unlock.'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Friends / Party panel */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» Party / Friends</h2>
          <div className={styles.panelBody}>
            {/* Invite code is UI-only for now — copying it is the only action available */}
            <div className={styles.inviteRow}>
              <span className={styles.inviteCode}>{inviteCode}</span>
              <button className={styles.inviteCopyBtn} onClick={handleCopyInvite}>Copy</button>
            </div>
            <form className={styles.addFriendForm} onSubmit={handleAddFriend}>
              <input
                className={styles.addFriendInput}
                placeholder="Enter username..."
                value={friendInput}
                onChange={e => { setFriendInput(e.target.value); setFriendError(''); }}
              />
              <button className={styles.addFriendBtn} type="submit">Add</button>
            </form>
            {friendError && <p className={styles.friendError}>{friendError}</p>}
            {friendsLoading ? (
              <p className={styles.emptyMsg}>Loading...</p>
            ) : friends.length === 0 ? (
              <p className={styles.emptyMsg}>No companions yet.<br />Add a hero to your party.</p>
            ) : (
              <div className={styles.friendList}>
                {friends.map(f => (
                  <div key={f.username} className={styles.friendItem}>
                    {/* Online dot — always offline for now; wire to SignalR presence later */}
                    <span className={f.online ? styles.statusDotOnline : styles.statusDot} />
                    <span className={styles.friendName}>{f.username}</span>
                    <span className={styles.friendStatus}>Offline</span>
                    {/* Remove button — calls DELETE /api/friends/{username} */}
                    <button
                      className={styles.removeFriendBtn}
                      onClick={() => handleRemoveFriend(f.username)}
                      aria-label={`Remove ${f.username}`}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Lore / patch notes — flavour text written as in-world announcements */}
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>» The Descent Awakens</h2>
          <div className={styles.panelBody}>
            <p className={styles.loreVersion}>v0.1.0 — The Awakening</p>
            <p className={styles.loreDate}>Year of the Descent, First Age</p>
            <ul className={styles.loreList}>
              <li>The dungeon stirs from its slumber. Heroes may now answer the call and register their names.</li>
              <li>The Party system is established. Brave souls may seek companions for the descent.</li>
              <li>The Hall of Achievements opens its iron gates to all who dare enter.</li>
              <li>Ancient runes hint at combat, treasure, and horrors yet to come...</li>
            </ul>
          </div>
        </div>

      </div>

      {/* Toast notifications — short pop-ups that appear bottom-centre and fade after 3 s */}
      <div className={styles.toastContainer}>
        {toasts.map(t => (
          <div key={t.id} className={styles.toast}>{t.message}</div>
        ))}
      </div>

    </div>
  );
}
