// SettingsModal.tsx
// The settings panel opened by the ⚙ button (bottom-left of the home screen).
// Has three tabs:
//   Audio       — master / music / SFX volume sliders (stored, not wired to audio yet)
//   Keybindings — click any binding then press a key to remap it; Esc cancels
//   Display     — toggle CRT scanlines and FPS counter (FPS not implemented yet)
//
// All changes are applied immediately and saved to localStorage via HomePage's
// useEffect, so they persist across sessions without a separate Save button.

import { useState, useEffect } from 'react';
import type { GameSettings } from '../types/settingsTypes';
import { formatKey } from '../types/settingsTypes';
import styles from './SettingsModal.module.css';

// Human-readable labels for each keybind shown in the Keybindings tab.
const KEYBIND_LABELS: Record<keyof GameSettings['keybinds'], string> = {
  enterGame: 'Enter Game',
  attack: 'Attack',
  flee: 'Flee',
  useItem: 'Use Item',
  openInventory: 'Open Inventory',
};

interface Props {
  settings: GameSettings;
  onChange: (s: GameSettings) => void; // called immediately on every change
  onClose: () => void;
}

type Tab = 'audio' | 'keybinds' | 'display';

export default function SettingsModal({ settings, onChange, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('audio');

  // When non-null, we're waiting for the player to press a key for this binding.
  const [recording, setRecording] = useState<keyof GameSettings['keybinds'] | null>(null);

  // While recording, capture the next keypress at the window level (capture phase
  // so it runs before anything else) and save it as the new binding.
  useEffect(() => {
    if (!recording) return;
    function capture(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; } // Esc cancels without saving
      onChange({ ...settings, keybinds: { ...settings.keybinds, [recording!]: e.key } });
      setRecording(null);
    }
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [recording, settings, onChange]);

  function setVolume(key: 'masterVolume' | 'musicVolume' | 'sfxVolume', val: number) {
    onChange({ ...settings, [key]: val });
  }

  const tabs: Tab[] = ['audio', 'keybinds', 'display'];
  const tabLabels: Record<Tab, string> = { audio: 'Audio', keybinds: 'Keybindings', display: 'Display' };

  return (
    // Clicking the overlay (outside the modal) closes it
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>» Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tab switcher */}
        <div className={styles.tabs}>
          {tabs.map(t => (
            <button
              key={t}
              className={tab === t ? styles.tabActive : styles.tab}
              onClick={() => setTab(t)}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        <div className={styles.body}>

          {/* ── Audio tab ── */}
          {tab === 'audio' && (
            <div className={styles.section}>
              {(
                [
                  ['masterVolume', 'Master Volume'],
                  ['musicVolume', 'Music Volume'],
                  ['sfxVolume', 'SFX Volume'],
                ] as ['masterVolume' | 'musicVolume' | 'sfxVolume', string][]
              ).map(([key, label]) => (
                <div key={key} className={styles.sliderRow}>
                  <span className={styles.sliderLabel}>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings[key]}
                    onChange={e => setVolume(key, Number(e.target.value))}
                    className={styles.slider}
                  />
                  <span className={styles.sliderValue}>{settings[key]}</span>
                </div>
              ))}
              <p className={styles.note}>* Audio playback not yet implemented.</p>
            </div>
          )}

          {/* ── Keybindings tab ── */}
          {tab === 'keybinds' && (
            <div className={styles.section}>
              {(Object.keys(settings.keybinds) as (keyof GameSettings['keybinds'])[]).map(k => (
                <div key={k} className={styles.keybindRow}>
                  <span className={styles.keybindLabel}>{KEYBIND_LABELS[k]}</span>
                  {/* Button pulses and shows "press a key" while waiting for input */}
                  <button
                    className={recording === k ? styles.keybindBtnRecording : styles.keybindBtn}
                    onClick={() => setRecording(recording === k ? null : k)}
                  >
                    {recording === k ? '[ press a key ]' : formatKey(settings.keybinds[k])}
                  </button>
                </div>
              ))}
              <p className={styles.note}>Click a binding then press any key. Esc to cancel.</p>
            </div>
          )}

          {/* ── Display tab ── */}
          {tab === 'display' && (
            <div className={styles.section}>
              {/* Scanlines actually works — it removes the ::before CSS overlay on the page */}
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Scanlines</span>
                <button
                  className={settings.scanlines ? styles.toggleOn : styles.toggleOff}
                  onClick={() => onChange({ ...settings, scanlines: !settings.scanlines })}
                >
                  {settings.scanlines ? '[ ON ]' : '[ OFF ]'}
                </button>
              </div>
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Show FPS</span>
                <button
                  className={settings.showFps ? styles.toggleOn : styles.toggleOff}
                  onClick={() => onChange({ ...settings, showFps: !settings.showFps })}
                >
                  {settings.showFps ? '[ ON ]' : '[ OFF ]'}
                </button>
              </div>
              <p className={styles.note}>* FPS counter not yet implemented.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
