// Charts (SVG) and the relationship graph (canvas) can't use CSS variables
// directly, so they read the colours from styles.css through these helpers.
// That keeps every colour in one file: a dark theme later only needs new
// variable values there (see the note at the top of styles.css).

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function chartPalette() {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--chart-${i}`));
}

// valid / expiring / expired / failed / ... → colour
export function statusColor(status) {
  return cssVar(`--status-${status}`) || cssVar('--status-unknown');
}
