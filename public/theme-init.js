// Restore the theme before first paint to prevent a flash. Kept out of
// index.html so the Content-Security-Policy can forbid inline scripts.
try {
  if (localStorage.getItem('orion-theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  }
} catch {
  // Storage unavailable: keep the default dark theme.
}
