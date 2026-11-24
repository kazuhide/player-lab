// Only resolve publisher assets within the configured media directory.
export function mediaUrl(path, base) {
  const root = new URL(base);
  if (
    !['https:', 'http:'].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash
  )
    throw Error('Invalid media origin');
  root.pathname = root.pathname.replace(/\/?$/, '/');
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    /[%?#]/.test(path) ||
    path.split('/').includes('..')
  )
    throw Error('Invalid media path');
  const url = new URL(path, root);
  if (url.origin !== root.origin || url.username || url.password || !url.pathname.startsWith(root.pathname))
    throw Error('Invalid media path');
  return url.href;
}
export async function jsonAt(path, base) {
  const response = await fetch(mediaUrl(path, base), {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('Publisher unavailable');
  return response.json();
}
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function button(label, click) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', click);
  return element;
}
