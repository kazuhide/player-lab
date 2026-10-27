import { pathToFileURL } from 'node:url';

/** Read the SDK document without installing listeners or changing DOM/player state. */
export function embeddedUiSnapshot() {
  const rect = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  const visible = node => {
    const box = rect(node);
    if (box[2] <= 0 || box[3] <= 0) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  return { width: innerWidth, height: innerHeight, controls: [...document.querySelectorAll('button, [role="slider"]')].map(node => {
    const box = rect(node), hit = document.elementFromPoint(box[0] + box[2] / 2, box[1] + box[3] / 2);
    const shown = visible(node);
    return { id: node.id, label: node.getAttribute('aria-label'), role: node.getAttribute('role'), className: node.className,
      rect: box, visible: shown, hittable: shown && node.contains(hit) };
  }) };
}

async function main() {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof WebSocket !== 'function') throw new Error('Node 22 or newer and an owned local debugger port are required');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = targets.filter(target => target.type === 'page');
  if (pages.length !== 1) throw new Error('Expected one owned SDK WebView');
  const address = new URL(pages[0].webSocketDebuggerUrl);
  if (!['127.0.0.1', 'localhost'].includes(address.hostname) || Number(address.port) !== port) throw new Error('Unexpected SDK debugger endpoint');
  const socket = new WebSocket(address);
  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('SDK DOM observation deadline exceeded')), 5000);
      socket.addEventListener('error', () => reject(new Error('SDK debugger connection failed')));
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression: `(${embeddedUiSnapshot.toString()})()`, returnByValue: true } })));
      socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message); });
    });
    if (result.error || result.result?.exceptionDetails || !result.result?.result?.value) throw new Error('SDK DOM observation failed');
    console.log(JSON.stringify(result.result.result.value));
  } finally { clearTimeout(timer); socket.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { console.error('The owned SDK WebView could not be observed'); process.exitCode = 1; });
}
