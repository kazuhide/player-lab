export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function dataTable(headers, rows, caption) {
  const table = element('table');
  if (caption) table.append(element('caption', caption));
  const head = element('thead'); const tr = element('tr');
  for (const title of headers) { const th = element('th', title); th.scope = 'col'; tr.append(th); }
  head.append(tr); table.append(head);
  const body = element('tbody');
  for (const values of rows) {
    const row = element('tr');
    values.forEach((value, index) => { const cell = element(index === 0 ? 'th' : 'td', value); if (!index) cell.scope = 'row'; row.append(cell); });
    body.append(row);
  }
  table.append(body); return table;
}

function svgElement(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function drawChart(target, { series, period, title, empty, bars = false, segments, locale }) {
  target.replaceChildren();
  const values = series.flatMap(item => item.rows.filter(row => row.value !== null).map(row => row.value));
  if (!values.length) { target.append(element('p', empty, 'empty-chart')); return; }
  const width = Math.max(240, Math.min(640, target.clientWidth || 640)); const height = 210; const left = 48; const right = 18; const top = 12; const bottom = 34;
  const max = Math.max(...values, 1);
  const start = Date.parse(period.start); const end = Date.parse(period.end);
  const x = at => left + (Date.parse(at) - start) / (end - start) * (width - left - right);
  const y = value => height - bottom - value / max * (height - bottom - top);
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': title });
  svg.append(svgElement('title', {}, title));
  for (let step = 0; step < 3; step += 1) {
    const value = bars ? Math.min(max, Math.ceil(max * step / 2)) : max * step / 2; const at = y(value);
    svg.append(svgElement('line', { x1: left, y1: at, x2: width - right, y2: at, class: 'axis' }));
    svg.append(svgElement('text', { x: left - 8, y: at + 4, 'text-anchor': 'end' }, new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)));
  }
  series.forEach((item, index) => {
    if (bars) {
      const barWidth = Math.max(1, Math.min(22, (width - left - right) * 3_600_000 / (end - start) * .65));
      item.rows.filter(row => row.value !== null).forEach(row => {
        const position = Math.min(width - right - barWidth, Math.max(left, x(row.at)));
        svg.append(svgElement('rect', { x: position, y: y(row.value), width: barWidth, height: height - bottom - y(row.value), class: 'bar' }));
      });
    } else {
      for (const segment of segments(item.rows)) {
        const path = segment.map((row, i) => `${i ? 'L' : 'M'}${Math.max(left, x(row.at)).toFixed(2)},${y(row.value).toFixed(2)}`).join(' ');
        svg.append(svgElement('path', { d: path, class: index ? 'secondary-series' : 'primary-series' }));
        if (segment.length === 1) svg.append(svgElement('circle', { cx: Math.max(left, x(segment[0].at)), cy: y(segment[0].value), r: 3, class: index ? 'secondary-series' : 'primary-series' }));
      }
    }
  });
  for (const [at, anchor, position] of [[start, 'start', left], [end, 'end', width - right]]) {
    const date = new Date(at);
    const label = svgElement('text', { x: position, y: height - (width < 400 ? 20 : 8), 'text-anchor': anchor });
    if (width < 400) {
      label.append(svgElement('tspan', { x: position }, date.toISOString().slice(5, 10)));
      label.append(svgElement('tspan', { x: position, dy: 14 }, date.toISOString().slice(11, 16) + ' UTC'));
    } else label.textContent = date.toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
    svg.append(label);
  }
  target.append(svg);
}
