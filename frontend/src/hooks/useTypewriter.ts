// useTypewriter.ts
// Custom hook that reveals a string one character at a time, like a retro terminal.
//
// Usage:
//   const displayed = useTypewriter('Hello world'); // 'H', 'He', 'Hel', ...
//
// Used in HomePage to animate the "The hero [username] has returned" welcome text.
// The full string is split into three parts after typing so the username can be
// styled in a different colour — see HomePage.tsx for that logic.

import { useState, useEffect } from 'react';

export function useTypewriter(text: string, speed = 50) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    setDisplayed('');
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed); // speed is ms per character — lower = faster
    return () => clearInterval(id); // clean up if the component unmounts mid-animation
  }, [text, speed]);

  return displayed;
}
