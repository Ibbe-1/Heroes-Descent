// settingsTypes.ts
// Defines the shape of the player's settings and the default values.
// Settings are saved to localStorage under the key 'hd_settings' so they
// survive page refreshes. Any new setting added here should also get a
// default value in DEFAULT_SETTINGS.

// All settings the player can change from the Settings modal (⚙ button).
export interface GameSettings {
  masterVolume: number;   // 0–100, controls overall game audio
  musicVolume: number;    // 0–100, controls background music
  sfxVolume: number;      // 0–100, controls sound effects
  scanlines: boolean;     // toggles the CRT scanline CSS overlay on the home page
  showFps: boolean;       // placeholder — FPS counter not implemented yet
  keybinds: {
    enterGame: string;      // key that launches the game from the home screen
    attack: string;         // placeholder — used when combat is implemented
    flee: string;           // placeholder — used when combat is implemented
    useItem: string;        // placeholder — used when inventory is implemented
    openInventory: string;  // placeholder — used when inventory is implemented
  };
}

// What settings look like on a fresh install (before the player changes anything).
export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 80,
  musicVolume: 70,
  sfxVolume: 80,
  scanlines: true,
  showFps: false,
  keybinds: {
    enterGame: 'Enter',
    attack: 'a',
    flee: 'f',
    useItem: 'i',
    openInventory: 'e',
  },
};

// Converts raw e.key values (e.g. ' ', 'ArrowUp') into readable display strings.
// Used in the Keybindings tab and in the "press X to descend" hint on the home page.
export function formatKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  return key.length === 1 ? key.toUpperCase() : key;
}
