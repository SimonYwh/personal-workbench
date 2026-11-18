// 生成「个人工作台」快照：把待办、日程写成 README.md + data/*.json + index.html
// 由 sync.ps1 定时调用；不写回插件数据，只读。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = 'C:/Users/ywh/.dsh/profiles/desktop/created-plugins/4de8b7d5-b20f-40cd-8f17-39d64f1f0a98';
const DATA_DIR = join(PLUGIN, 'data');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_CHARS = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toMinutes = (time) => {
  if (typeof time !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};
const hm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const trim = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const esc = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function readJsonList(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    return [];
  } catch {
    return null;
  }
}

function todoLines(todos) {
  const open = [];
  const done = [];
  for (const todo of todos) {
    if (!todo || typeof todo.text !== 'string' || todo.text.trim() === '') continue;
    const subs = Array.isArray(todo.subs) ? todo.subs.filter((s) => s && typeof s.text === 'string') : [];
    const doneSubs = subs.filter((s) => s.done).length;
    const box = todo.done ? '[x]' : '[ ]';
    const progress = subs.length > 0 ? ` (${doneSubs}/${subs.length})` : '';
    const line = `- ${box} ${trim(todo.text.trim(), 120)}${progress}`;
    const childLines = subs
      .filter((s) => !todo.done || !s.done)
      .map((s) => `  - ${s.done ? '[x]' : '[ ]'} ${trim(s.text.trim(), 100)}`);
    const block = [line, ...childLines].join('\n');
    (todo.done ? done : open).push(block);
  }
  return { open, done };
}

function scheduleBlocks(items, key) {
  const byKey = new Map();
  for (const item of items) {
    if (!item || item.date !== key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const list = byKey.get(key) ?? [];
  const sorted = list.slice().sort((a, b) => {
    const am = toMinutes(a.start);
    const bm = toMinutes(b.start);
    return (am ?? 24 * 60) - (bm ?? 24 * 60);
  });
  const rows = [];
  let prevEnd = -1;
  for (const item of sorted) {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title.trim() : '(未命名)';
    const conflict = start !== null && prevEnd > start;
    const range = start === null ? '未定时间' : `${item.start}–${item.end ?? '?'}`;
    rows.push(`- ${conflict ? '⚠️ ' : ''}\`${range}\` ${trim(title, 120)}`);
    if (end !== null && end > prevEnd) prevEnd = end;
  }
  return rows;
}

function dayHeading(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

/**
 * 把某天排成「时间轴块」：有起止时间的按分钟定位，重叠的按簇分道。
 * 返回 { blocks, untimed }，blocks 元素 { start, end, title, conflict, lane, lanes }。
 */
function dayLayout(items, key) {
  const timed = [];
  const untimed = [];
  for (const item of items) {
    if (!item || item.date !== key) continue;
    const title = typeof item.title === 'string' && item.title.trim() !== '' ? item.title.trim() : '(未命名)';
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    if (start === null) {
      untimed.push({ title });
      continue;
    }
    timed.push({ start, end: end !== null && end > start ? end : start + 30, title });
  }
  timed.sort((a, b) => a.start - b.start || a.end - b.end);

  const blocks = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnd = [];
    for (const block of cluster) {
      let lane = 0;
      while (laneEnd[lane] !== undefined && laneEnd[lane] > block.start) lane += 1;
      laneEnd[lane] = block.end;
      block.lane = lane;
    }
    const lanes = Math.max(1, laneEnd.length);
    for (const block of cluster) block.lanes = lanes;
    blocks.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };
  for (const block of timed) {
    if (cluster.length > 0 && block.start >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length > 0) flush();
  blocks.sort((a, b) => a.start - b.start);

  let prevEnd = -1;
  for (const block of blocks) {
    block.conflict = block.start < prevEnd;
    prevEnd = Math.max(prevEnd, block.end);
  }
  return { blocks, untimed };
}

/* ------------------------------------------------------------------ 页面 */

const PAGE_CSS = `
:root{
  --paper:#FAF6EE; --ink:#1F1A15; --ink2:#6B5F53; --ink3:#786C5E;
  --rule:#E2D8C9; --rule2:#EDE5D8;
  --red:#B4371C; --amber:#C4713F; --blue:#547BB4; --ok:#5B8F3A;
  --serif:"Noto Serif SC","Songti SC","Source Han Serif SC",SimSun,serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --display:"Noto Serif SC","Songti SC",SimSun,serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#141210; --ink:#F2E9DC; --ink2:#A99B8B; --ink3:#8C7E6F;
    --rule:#302A24; --rule2:#262119;
    --red:#E0998D; --amber:#D98B57; --blue:#7F9CC7; --ok:#9CBF74;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:var(--serif);font-size:15px;line-height:1.62;
  font-kerning:normal;text-rendering:optimizeLegibility;
  background-image:radial-gradient(120% 60% at 50% -10%,rgba(180,55,28,.055),transparent 70%);
  background-repeat:no-repeat;
}
main{max-width:660px;margin:0 auto;padding:22px 20px 64px}

/* —— 报头 —— */
.mast{padding-bottom:16px;border-bottom:2.5px solid var(--ink)}
.kick{
  margin:0 0 12px;display:flex;align-items:baseline;gap:8px;
  font-family:var(--mono);font-size:10px;font-weight:500;
  letter-spacing:.26em;text-transform:uppercase;color:var(--ink2);
}
.kick i{font-style:normal;color:var(--red)}
.kick .no{margin-left:auto;letter-spacing:.14em;color:var(--ink3)}
h1{
  margin:0;display:flex;align-items:flex-end;justify-content:space-between;gap:14px;
  font-family:var(--display);font-weight:700;
  font-size:clamp(29px,7.9vw,39px);line-height:1.04;letter-spacing:-.025em;
}
.dnum{
  flex:none;font-size:clamp(50px,12.6vw,66px);line-height:.78;color:var(--red);
  letter-spacing:-.05em;font-variant-numeric:lining-nums;
}
.sub{
  margin:9px 0 0;display:flex;flex-wrap:wrap;gap:0 8px;align-items:baseline;
  font-size:13px;color:var(--ink2);
}
.sub b{color:var(--ink);font-weight:600}
.sub .stamp{font-family:var(--mono);font-size:11px;letter-spacing:.02em;color:var(--ink3)}
.sep{color:var(--rule);}
.tally{
  margin:14px 0 0;display:flex;gap:18px;font-size:11px;
  font-family:var(--mono);letter-spacing:.08em;color:var(--ink3);text-transform:uppercase;
}
.tally b{display:block;font-family:var(--display);font-size:19px;letter-spacing:-.01em;color:var(--ink);font-weight:700;line-height:1.1}

/* —— 本周 —— */
.wk{
  display:grid;grid-template-columns:repeat(7,1fr);gap:4px;
  margin:0 -2px;padding:14px 2px 12px;border-bottom:1px solid var(--rule);
}
.wk a{display:block;text-decoration:none;color:inherit;text-align:center}
.wk i{display:block;font-family:var(--mono);font-size:9.5px;font-style:normal;letter-spacing:.1em;color:var(--ink3)}
.wk b{display:block;font-family:var(--mono);font-size:15px;font-weight:500;color:var(--ink2);line-height:1.35;font-variant-numeric:tabular-nums}
.wk nav{display:contents}
.wk .today i{color:var(--red)}
.wk .today b{color:var(--red);font-weight:600}
.wk .dots{display:flex;justify-content:center;gap:2px;height:6px;margin-top:3px}
.wk .dots s{width:4px;height:4px;border-radius:50%;background:var(--ink3);text-decoration:none}
.wk .today .dots s{background:var(--red)}
.wk .dots s.off{background:transparent;box-shadow:inset 0 0 0 1px var(--rule)}

/* —— 分区 —— */
section{margin-top:26px}
.head{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.fol{
  font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--red);
  border:1px solid currentColor;border-radius:2px;padding:1px 4px;line-height:1.2;
}
h2{margin:0;font-size:12px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);font-family:var(--mono)}
.head .note{margin-left:auto;font-size:11px;color:var(--ink3);font-family:var(--mono)}

/* —— 现在 —— */
.nowbar{
  display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 14px;
  padding:9px 12px;background:var(--rule2);border-left:3px solid var(--red);
  font-size:13.5px;line-height:1.45;
}
.nowbar .dot{width:7px;height:7px;border-radius:50%;background:var(--red);flex:none;animation:pulse 2.4s ease-in-out infinite}
.nowbar b{font-weight:600;letter-spacing:.02em}
.nowbar em{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--ink2);margin-left:auto;font-variant-numeric:tabular-nums}
@media (prefers-color-scheme:dark){.nowbar{background:#1E1A16}}

/* —— 时间轴 —— */
.tl{position:relative;margin-left:38px;border-left:1px solid var(--rule);
  background-image:repeating-linear-gradient(to bottom,var(--rule2) 0 1px,transparent 1px var(--hour,54px))}
.tl-h{position:absolute;left:-38px;width:34px;text-align:right;font-family:var(--mono);font-size:9.5px;color:var(--ink3);letter-spacing:.04em;transform:translateY(-50%)}
.tl-h::after{content:"";position:absolute;right:-2px;top:50%;width:38px;height:1px;background:var(--rule2);opacity:.9}
.tl-now{position:absolute;left:0;right:0;height:0;border-top:1.5px solid var(--red);z-index:3}
.tl-now::before{content:"";position:absolute;left:-4px;top:-4.5px;width:7px;height:7px;border-radius:50%;background:var(--red)}
.tl-now span{position:absolute;right:0;top:-9px;font-family:var(--mono);font-size:9px;color:var(--red);background:var(--paper);padding:0 3px;letter-spacing:.04em}
.ev.live{border-left-width:3px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--blue) 34%,transparent)}
.ev.alt.live{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--amber) 34%,transparent)}
.ev{
  position:absolute;padding:4px 7px 5px;border-left:2px solid var(--blue);
  background:color-mix(in srgb,var(--blue) 12%,transparent);
  font-size:12.5px;line-height:1.35;overflow:hidden;
}
.ev b{display:block;font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:.03em;color:var(--ink2)}
.ev span{display:block;margin-top:1px;font-size:12.5px;font-weight:600;letter-spacing:-.005em}
.ev.alt{border-left-color:var(--amber);background:color-mix(in srgb,var(--amber) 14%,transparent)}
.ev.warn{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 12%,transparent)}
.ev.short{padding:3px 7px}
.ev.short span,.ev.short b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev.short span{display:inline;margin-left:6px}
.ev.short b{display:inline}
@media (prefers-color-scheme:dark){.ev{background:color-mix(in srgb,var(--blue) 22%,transparent)}.ev.alt{background:color-mix(in srgb,var(--amber) 22%,transparent)}.ev.warn{background:color-mix(in srgb,var(--red) 20%,transparent)}}

.loose{margin:14px 0 0;padding:10px 0 0;border-top:1px dashed var(--rule)}
.loose p{margin:0;font-size:12px;color:var(--ink2);font-family:var(--mono);letter-spacing:.06em}
.loose ul{margin:6px 0 0}
.loose li{font-size:13.5px}

/* —— 行式列表 —— */
ul{list-style:none;margin:0;padding:0}
.row{display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--rule2);align-items:baseline}
.row:first-child{border-top:0}
.row .t{flex:none;width:44px;font-family:var(--mono);font-size:11px;color:var(--ink3);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.row .x{flex:1;word-break:break-word;font-size:14px}
.row.warn .t{color:var(--red);font-weight:600}
.row.warn .x::before{content:"⚠︎ ";color:var(--red)}
.dayname{
  margin:20px 0 8px;display:flex;align-items:baseline;gap:8px;
  font-size:11px;font-family:var(--mono);letter-spacing:.14em;color:var(--ink2);text-transform:uppercase;
}
.dayname::after{content:"";flex:1;height:1px;background:var(--rule);transform:translateY(-3px)}
.dayname b{color:var(--ink);font-size:11px}
.day:first-child .dayname{margin-top:0}

/* —— 待办 —— */
.todos li{display:flex;gap:11px;padding:9px 0;border-top:1px solid var(--rule2);align-items:flex-start}
.todos li:first-child{border-top:0}
.mk{flex:none;width:15px;height:15px;margin-top:3px;border:1.3px solid var(--ink3);border-radius:2px;display:grid;place-items:center}
.mk i{font-size:10px;color:transparent;font-style:normal;transform:translateY(-1px)}
.done .mk{border-color:var(--ok);background:var(--ok)}
.done .mk i{color:var(--paper)}
.body{flex:1;min-width:0}
.tx{margin:0;font-size:14.5px;letter-spacing:-.005em;word-break:break-word}
.done .tx{color:var(--ink3);text-decoration:line-through;text-decoration-color:var(--ink3);text-decoration-thickness:1px}
.subs{margin:5px 0 0;padding:0}
.subs li{display:flex;gap:7px;padding:2px 0;border:0;font-size:13px;color:var(--ink2);align-items:baseline}
.subs .tick{flex:none;font-family:var(--mono);font-size:10px;color:var(--ink3);width:10px}
.subs li.ok .tick{color:var(--ok)}
.subs li.ok span{color:var(--ink3);text-decoration:line-through;text-decoration-thickness:1px}
.fr{flex:none;font-family:var(--mono);font-size:10.5px;color:var(--ink3);letter-spacing:.02em;padding-top:5px;font-variant-numeric:tabular-nums}

/* —— 折叠与页脚 —— */
.fold{margin-top:22px;border-top:1px solid var(--rule);padding-top:10px}
.fold summary{
  cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);
}
.fold summary::-webkit-details-marker{display:none}
.fold summary::before{content:"+";font-size:13px;color:var(--ink3)}
.fold[open] summary::before{content:"−"}
.fold summary b{color:var(--ink2);font-weight:500}
.fold>div,.fold>ul{margin-top:10px}
.void{margin:2px 0 0;padding:16px 0;font-size:13px;color:var(--ink3);text-align:center;border:1px dashed var(--rule);border-radius:2px}
footer{margin-top:34px;padding-top:12px;border-top:2.5px solid var(--ink);font-size:11.5px;line-height:1.7;color:var(--ink2)}
footer code{font-family:var(--mono);font-size:10.5px;color:var(--ink3)}
footer .stamp{font-family:var(--mono);font-size:10.5px;color:var(--ink3);letter-spacing:.02em;display:block;margin-top:6px}
a{color:var(--red)}

/* —— 入场 —— */
.rise{animation:rise .52s cubic-bezier(.22,.68,.24,1) both;animation-delay:calc(var(--i,0)*70ms)}
@keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.rise,.nowbar .dot{animation:none}}

@media print{
  body{background:#fff}
  .rise,.nowbar .dot{animation:none}
  .fold{border-top:0}
  footer{border-top:1px solid #000}
}
`;

function scheduleRows(items, key) {
  const { blocks, untimed } = dayLayout(items, key);
  const rows = blocks.map((block) => ({
    range: `${hm(block.start)}–${hm(block.end)}`,
    title: block.title,
    conflict: block.conflict,
  }));
  for (const item of untimed) rows.push({ range: '未定', title: item.title, conflict: false });
  return rows;
}

const TICK = '<i class="tick">·</i>';

function renderTimeline(items, key, nowMinutes, isToday) {
  const { blocks, untimed } = dayLayout(items, key);
  const parts = [];

  if (blocks.length === 0) {
    parts.push('<p class="void">今天没有安排</p>');
  } else {
    const firstStart = blocks[0].start;
    const lastEnd = blocks.reduce((max, block) => Math.max(max, block.end), 0);
    const lo = Math.max(0, Math.floor((firstStart - 30) / 60));
    const hi = Math.min(24, Math.max(Math.ceil((lastEnd + 30) / 60), lo + 3));
    // 轴高随跨度自适应：整天都很满时压缩每小时高度，保证不裁切也不过度拉长
    const HOUR = Math.max(26, Math.min(56, Math.round(560 / Math.max(1, hi - lo))));

    const parts2 = [];
    for (let hour = lo; hour <= hi; hour += 1) {
      parts2.push(
        `<div class="tl-h" style="top:${(hour - lo) * HOUR}px">${pad(hour)}:00</div>`,
      );
    }
    if (isToday && nowMinutes >= lo * 60 && nowMinutes <= hi * 60) {
      parts2.push(
        `<div class="tl-now" style="top:${((nowMinutes - lo * 60) / 60) * HOUR}px"><span>${hm(nowMinutes)}</span></div>`,
      );
    }
    for (const block of blocks) {
      const lanes = block.lanes;
      const width = 100 / lanes;
      const top = ((block.start - lo * 60) / 60) * HOUR;
      const height = Math.max(24, ((block.end - block.start) / 60) * HOUR - 2);
      const live = isToday && block.start <= nowMinutes && nowMinutes < block.end;
      const cls = [
        'ev',
        block.lane % 2 === 1 ? 'alt' : '',
        block.conflict ? 'warn' : '',
        height < 34 ? 'short' : '',
        live ? 'live' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const inner =
        height < 34
          ? `<b>${hm(block.start)}</b><span>${esc(trim(block.title, 40))}</span>`
          : `<b>${hm(block.start)}–${hm(block.end)}</b><span>${esc(trim(block.title, 60))}</span>`;
      parts2.push(
        `<div class="${cls}" style="top:${top + 1}px;height:${height}px;left:calc(${block.lane * width}% + 1px);width:calc(${width}% - 3px)">${inner}</div>`,
      );
    }
    parts.push(
      `<div class="tl" style="height:${(hi - lo) * HOUR + 14}px;--hour:${HOUR}px">${parts2.join('')}</div>`,
    );
  }

  if (untimed.length > 0) {
    parts.push(
      `<div class="loose"><p>未定时间 · ${untimed.length}</p><ul>` +
        untimed
          .map((item) => `<li class="row"><span class="t">—</span><span class="x">${esc(trim(item.title, 90))}</span></li>`)
          .join('') +
        '</ul></div>',
    );
  }
  return parts.join('');
}

function renderNowBar(items, key, nowMinutes) {
  const { blocks } = dayLayout(items, key);
  if (blocks.length === 0) {
    return blocks.length === 0 ? '' : '<p class="nowbar"><span class="dot"></span>今天没有安排</p>';
  }
  const current = blocks.find((block) => block.start <= nowMinutes && nowMinutes < block.end);
  if (current) {
    const left = current.end - nowMinutes;
    return `<p class="nowbar"><span class="dot"></span><b>进行中</b> ${esc(
      trim(current.title, 42),
    )}<em>${hm(current.start)}–${hm(current.end)} · 剩 ${left} 分</em></p>`;
  }
  const next = blocks.find((block) => block.start > nowMinutes);
  if (next) {
    const inMin = next.start - nowMinutes;
    return `<p class="nowbar"><span class="dot"></span><b>下一项</b> ${hm(next.start)} ${esc(
      trim(next.title, 40),
    )}<em>再 ${inMin} 分</em></p>`;
  }
  return `<p class="nowbar"><span class="dot"></span>今天的安排都过去了<em>${hm(nowMinutes)}</em></p>`;
}

function renderWeek(now, items) {
  const cells = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(now, i);
    const key = dateKey(day);
    const { blocks, untimed } = dayLayout(items, key);
    const count = Math.min(3, blocks.length + (untimed.length > 0 ? 1 : 0));
    const dots = [0, 1, 2]
      .map((index) => `<s class="${index < count ? '' : 'off'}"></s>`)
      .join('');
    cells.push(
      `<a class="${i === 0 ? 'today' : ''}"><i>${WEEK_CHARS[day.getDay()]}</i><b>${day.getDate()}</b><span class="dots">${dots}</span></a>`,
    );
  }
  return `<nav class="wk" aria-label="本周">${cells.join('')}</nav>`;
}

function todoList(todos) {
  const rows = todos.filter((todo) => typeof todo.text === 'string' && todo.text.trim() !== '');
  if (rows.length === 0) return '<p class="void">全部完成</p>';
  const parts = ['<ul class="todos">'];
  for (const todo of rows) {
    const subs = Array.isArray(todo.subs) ? todo.subs.filter((s) => s && typeof s.text === 'string') : [];
    const doneSubs = subs.filter((s) => s.done).length;
    const sub =
      subs.length > 0
        ? '<ul class="subs">' +
          subs
            .map((item) => `<li class="${item.done ? 'ok' : ''}">${TICK}<span>${esc(trim(item.text.trim(), 160))}</span></li>`)
            .join('') +
          '</ul>'
        : '';
    parts.push(
      `<li class="${todo.done ? 'done' : 'open'}"><span class="mk"><i>✓</i></span>` +
        `<div class="body"><p class="tx">${esc(trim(todo.text.trim(), 200))}</p>${sub}</div>` +
        `${subs.length > 0 ? `<span class="fr">${doneSubs}/${subs.length}</span>` : ''}</li>`,
    );
  }
  parts.push('</ul>');
  return parts.join('');
}

function renderDayRows(items, key) {
  const rows = scheduleRows(items, key);
  return (
    '<ul>' +
    rows
      .map(
        (row) =>
          `<li class="row${row.conflict ? ' warn' : ''}"><span class="t">${esc(
            row.range.split('–')[0],
          )}</span><span class="x">${esc(trim(row.title, 160))}</span></li>`,
      )
      .join('') +
    '</ul>'
  );
}

function renderHtml(now, todos, items) {
  const todayKey = dateKey(now);
  const openCount = todos.filter((todo) => !todo.done).length;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayToday = dayLayout(items, todayKey);
  const todayCount = todayToday.blocks.length + todayToday.untimed.length;
  const stamp = `更新于 ${dateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const past = items
    .filter((item) => item.date < todayKey)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const done = todos.filter((todo) => todo.done);
  const open = todos.filter((todo) => !todo.done);

  const upcoming = [];
  for (let i = 1; i <= 6; i += 1) {
    const day = addDays(now, i);
    const rows = scheduleRows(items, dateKey(day));
    if (rows.length === 0) continue;
    upcoming.push(
      `<div class="day"><div class="dayname"><b>${esc(dayHeading(day))}</b><span>${rows.length}</span></div>${renderDayRows(
        items,
        dateKey(day),
      )}</div>`,
    );
  }

  const parts = [];
  parts.push('<!doctype html>');
  parts.push('<html lang="zh-CN">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<meta name="color-scheme" content="light dark">');
  parts.push('<meta name="theme-color" content="#FAF6EE" media="(prefers-color-scheme:light)">');
  parts.push('<meta name="theme-color" content="#141210" media="(prefers-color-scheme:dark)">');
  parts.push('<meta name="robots" content="noindex,nofollow">');
  parts.push('<title>个人工作台 · 每日一览</title>');
  parts.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  parts.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  parts.push(
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">',
  );
  parts.push(`<style>${PAGE_CSS}</style>`);
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<main>');

  parts.push('<header class="mast rise" style="--i:0">');
  parts.push(`<p class="kick"><span>Daily&nbsp;Sheet <i>／</i> 每日一览</span><span class="no">№ ${dayOfYear(now)}</span></p>`);
  parts.push(`<h1><span>个人工作台</span><b class="dnum">${now.getDate()}</b></h1>`);
  parts.push(
    `<p class="sub"><b>${now.getMonth() + 1}月</b>${WEEKDAYS[now.getDay()]}<span class="sep">／</span><span class="stamp">${esc(
      stamp,
    )}</span></p>`,
  );
  parts.push(
    `<p class="tally"><span><b>${openCount}</b>未完成待办</span><span><b>${todayCount}</b>今日安排</span><span><b>${items.length}</b>全部日程</span></p>`,
  );
  parts.push('</header>');

  parts.push(renderWeek(now, items));

  parts.push('<section class="rise" style="--i:1">');
  parts.push(
    `<div class="head"><span class="fol">01</span><h2>今天 · ${esc(dayHeading(now))}</h2><span class="note">${nowCount(
      todayCount,
    )}</span></div>`,
  );
  parts.push(renderNowBar(items, todayKey, nowMinutes));
  parts.push(renderTimeline(items, todayKey, nowMinutes, true));
  parts.push('</section>');

  parts.push('<section class="rise" style="--i:2">');
  parts.push(
    `<div class="head"><span class="fol">02</span><h2>待办</h2><span class="note">${openCount} 项</span></div>`,
  );
  parts.push(todoList(open));
  parts.push('</section>');

  parts.push('<section class="rise" style="--i:3">');
  parts.push(
    `<div class="head"><span class="fol">03</span><h2>接下来</h2><span class="note">${upcoming.length} 天有安排</span></div>`,
  );
  parts.push(upcoming.length > 0 ? upcoming.join('') : '<p class="void">未来一周还没有安排</p>');
  parts.push('</section>');

  if (past.length > 0) {
    parts.push(
      `<details class="fold"><summary>已过期 <b>${past.length}</b></summary><ul>` +
        past
          .slice(0, 30)
          .map((item) => {
            const title = typeof item.title === 'string' ? item.title : '(未命名)';
            return `<li class="row"><span class="t">${esc(item.date.slice(5))}</span><span class="x">${esc(
              trim(title, 120),
            )}</span></li>`;
          })
          .join('') +
        '</ul></details>',
    );
  }

  if (done.length > 0) {
    parts.push(`<details class="fold"><summary>已完成 <b>${done.length}</b></summary>${todoList(done)}</details>`);
  }

  parts.push(
    '<footer>这是一份本机生成的静态快照，手机上只读。要改待办或日程，回 DSH 会话里说一声；' +
      '页面每 10 分钟自动翻新一次，也可以在工作台里点「同步到手机」立刻更新。' +
      `<span class="stamp">${esc(stamp)}</span></footer>`,
  );
  parts.push('</main>');
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n') + '\n';
}

function nowCount(count) {
  return count === 0 ? '—' : `${count} 条`;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000) + 1;
}

async function main() {
  const now = new Date();
  const todos = await readJsonList(join(DATA_DIR, 'todos.json'));
  const schedule = await readJsonList(join(DATA_DIR, 'schedule.json'));
  const filteredTodos = (todos ?? []).filter((todo) => todo && typeof todo.text === 'string');
  const filteredSchedule = (schedule ?? []).filter((item) => item && typeof item.date === 'string');
  const { open, done } = todoLines(filteredTodos);

  const out = [];
  out.push('# 个人工作台');
  out.push('');
  out.push(`更新于 ${dateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}　·　待办 ${open.length} 项未完成　·　日程 ${filteredSchedule.length} 条`);
  out.push('');
  if (todos === null || schedule === null) {
    out.push('> ⚠️ 本机数据文件暂时读不到，以下内容可能不完整。');
    out.push('');
  }

  const today = now;
  const todayKey = dateKey(today);
  out.push(`## 今天 · ${dayHeading(today)}`);
  out.push('');
  const todayRows = scheduleBlocks(filteredSchedule, todayKey);
  out.push(...(todayRows.length > 0 ? todayRows : ['- 今天没有排定时间']));
  out.push('');

  out.push('## 接下来 7 天');
  out.push('');
  let anyUpcoming = false;
  for (let i = 1; i <= 6; i += 1) {
    const day = addDays(today, i);
    const key = dateKey(day);
    const rows = scheduleBlocks(filteredSchedule, key);
    if (rows.length === 0) continue;
    anyUpcoming = true;
    out.push(`### ${dayHeading(day)}`);
    out.push('');
    out.push(...rows);
    out.push('');
  }
  if (!anyUpcoming) {
    out.push('- 未来一周还没有安排');
    out.push('');
  }

  const past = filteredSchedule
    .map((item) => item)
    .filter((item) => item.date < todayKey)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (past.length > 0) {
    out.push('<details><summary>已过期的日程 ' + past.length + ' 条</summary>');
    out.push('');
    for (const item of past.slice(0, 30)) {
      const title = typeof item.title === 'string' ? item.title : '(未命名)';
      out.push(`- ${item.date} \`${item.start ?? '?'}–${item.end ?? '?'}\` ${trim(title, 100)}`);
    }
    out.push('');
    out.push('</details>');
    out.push('');
  }

  out.push('## 待办');
  out.push('');
  out.push(...(open.length > 0 ? open : ['- 全部完成 🎉']));
  out.push('');
  if (done.length > 0) {
    out.push(`<details><summary>已完成 ${done.length} 项</summary>`);
    out.push('');
    out.push(...done);
    out.push('');
    out.push('</details>');
    out.push('');
  }

  out.push('');
  out.push('---');
  out.push('');
  out.push('> 这份文件由本机生成并推送，仓库已公开、页面在 https://simonywh.github.io/personal-workbench/ 。');
  out.push('> 要让 agent 改待办或日程，在会话里说「加到待办」「把周三的测试挪到周四」即可，改完这里下一次同步就是新的。');

  const body = `${out.join('\n')}\n`;
  let previous = '';
  try {
    previous = await readFile(join(HERE, 'README.md'), 'utf8');
  } catch {
    previous = '';
  }
  const stripStamp = (text) => text.split('\n').filter((line) => !line.startsWith('更新于 ')).join('\n');
  const changed = stripStamp(previous) !== stripStamp(body);
  if (changed) {
    await writeFile(join(HERE, 'README.md'), body, 'utf8');
  }

  const html = renderHtml(now, filteredTodos, filteredSchedule);
  let previousHtml = '';
  try {
    previousHtml = await readFile(join(HERE, 'index.html'), 'utf8');
  } catch {
    previousHtml = '';
  }
  const stripHtmlStamp = (text) => text.replace(/<span class="stamp">[^<]*<\/span>/g, '');
  const htmlChanged = stripHtmlStamp(previousHtml) !== stripHtmlStamp(html);
  if (htmlChanged) {
    await writeFile(join(HERE, 'index.html'), html, 'utf8');
  }
  await writeFile(join(HERE, '.nojekyll'), '', 'utf8');

  await mkdir(join(HERE, 'data'), { recursive: true });
  await writeFile(
    join(HERE, 'data', 'todos.json'),
    `${JSON.stringify(filteredTodos, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(HERE, 'data', 'schedule.json'),
    `${JSON.stringify(filteredSchedule, null, 2)}\n`,
    'utf8',
  );
  console.log(`ok ${dateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} open=${open.length} done=${done.length} schedule=${filteredSchedule.length} changed=${changed} html=${htmlChanged}`);
}

main().catch((error) => {
  console.error('gen failed:', error);
  process.exitCode = 1;
});

