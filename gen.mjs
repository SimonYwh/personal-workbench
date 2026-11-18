// 生成「个人工作台」快照：把待办、日程、团队动态写成 README.md + data/*.json
// 由 sync.ps1 定时调用；不写回插件数据，只读。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = 'C:/Users/ywh/.dsh/profiles/desktop/created-plugins/4de8b7d5-b20f-40cd-8f17-39d64f1f0a98';
const DATA_DIR = join(PLUGIN, 'data');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

const PAGE_CSS = `
:root{--bg:#FBF8F4;--card:#fff;--ink:#2B2622;--muted:#7A7069;--line:#E6DFD6;--accent:#DD7C4F;--ok:#629C35;--warn:#C0321A}
@media (prefers-color-scheme:dark){:root{--bg:#17140F;--card:#221E19;--ink:#F2EAE1;--muted:#A79C91;--line:#352F28;--accent:#E0998D;--ok:#A9C97E;--warn:#D06553}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:20px 16px 56px}
h1{margin:0 0 4px;font-size:21px;letter-spacing:-.01em}
.stamp{margin:0;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.stats{margin:2px 0 0;color:var(--muted);font-size:12.5px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-top:14px}
h2{margin:0 0 10px;font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h3{margin:12px 0 6px;font-size:13.5px;font-weight:600}
ul{list-style:none;margin:0;padding:0}
li{padding:7px 0;border-top:1px solid var(--line);display:flex;gap:10px;align-items:flex-start}
li:first-child{border-top:0}
.time{flex:none;font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--muted);min-width:86px;padding-top:1px}
.conflict .time{color:var(--warn);font-weight:600}
.conflict .title::before{content:"⚠️ "}
.title{flex:1;word-break:break-word}
.done .title{color:var(--muted);text-decoration:line-through}
.box{flex:none;width:17px;height:17px;margin-top:2px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;font-size:11px;color:var(--ok)}
.done .box{background:var(--ok);border-color:var(--ok);color:#fff}
.prog{flex:none;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;padding-top:2px}
.subs{flex:1;margin:4px 0 0;padding-left:2px}
.subs li{border-top:0;padding:2px 0;color:var(--muted);font-size:13.5px}
details{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px}
summary{cursor:pointer;font-size:13px;color:var(--muted)}
details ul{margin-top:8px}
.empty{color:var(--muted);padding:6px 0}
footer{margin-top:22px;color:var(--muted);font-size:12px;line-height:1.7}
a{color:var(--accent)}
`

function scheduleRows(items, key) {
  const sorted = items
    .filter((item) => item.date === key)
    .slice()
    .sort((a, b) => (toMinutes(a.start) ?? 24 * 60) - (toMinutes(b.start) ?? 24 * 60));
  const rows = [];
  let prevEnd = -1;
  for (const item of sorted) {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    const conflict = start !== null && prevEnd > start;
    rows.push({
      range: start === null ? '未定时间' : `${item.start}–${item.end ?? '?'}`,
      title: typeof item.title === 'string' && item.title.trim() !== '' ? item.title.trim() : '(未命名)',
      conflict,
    });
    if (end !== null && end > prevEnd) prevEnd = end;
  }
  return rows;
}

function scheduleList(items, key) {
  const rows = scheduleRows(items, key);
  if (rows.length === 0) return '<p class="empty">今天没有排定时间</p>';
  return [
    '<ul>',
    ...rows.map(
      (row) =>
        `<li${row.conflict ? ' class="conflict"' : ''}><span class="time">${esc(row.range)}</span><span class="title">${esc(
          trim(row.title, 160),
        )}</span></li>`,
    ),
    '</ul>',
  ].join('\n');
}

function todoList(todos) {
  const rows = todos.filter((todo) => typeof todo.text === 'string' && todo.text.trim() !== '');
  if (rows.length === 0) return '<p class="empty">全部完成 🎉</p>';
  const parts = ['<ul>'];
  for (const todo of rows) {
    const subs = Array.isArray(todo.subs) ? todo.subs.filter((s) => s && typeof s.text === 'string') : [];
    const doneSubs = subs.filter((s) => s.done).length;
    parts.push(
      `<li class="${todo.done ? 'done' : 'open'}"><span class="box">${todo.done ? '✓' : ''}</span>` +
        `<span class="title">${esc(trim(todo.text.trim(), 200))}${
          subs.length > 0
            ? '<ul class="subs">' +
              subs
                .map((sub) => `<li>${sub.done ? '✓ ' : '· '}${esc(trim(sub.text.trim(), 160))}</li>`)
                .join('') +
              '</ul>'
            : ''
        }</span>` +
        `${subs.length > 0 ? `<span class="prog">${doneSubs}/${subs.length}</span>` : ''}</li>`,
    );
  }
  parts.push('</ul>');
  return parts.join('\n');
}

function renderHtml(now, todos, items) {
  const todayKey = dateKey(now);
  const openCount = todos.filter((todo) => !todo.done).length;
  const stamp = `更新于 ${dateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const parts = [];
  parts.push('<!doctype html>');
  parts.push('<html lang="zh-CN">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<meta name="color-scheme" content="light dark">');
  parts.push('<title>个人工作台</title>');
  parts.push(`<style>${PAGE_CSS}</style>`);
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<main>');
  parts.push('<h1>个人工作台</h1>');
  parts.push(`<p class="stamp">${esc(stamp)}</p>`);
  parts.push(`<p class="stats">待办 ${openCount} 项未完成　·　日程 ${items.length} 条</p>`);

  parts.push('<section>');
  parts.push(`<h2>今天 · ${esc(dayHeading(now))}</h2>`);
  parts.push(scheduleList(items, todayKey));
  parts.push('</section>');

  const upcoming = [];
  for (let i = 1; i <= 6; i += 1) {
    const day = addDays(now, i);
    const rows = scheduleRows(items, dateKey(day));
    if (rows.length === 0) continue;
    upcoming.push(`<h3>${esc(dayHeading(day))}</h3>`);
    upcoming.push(scheduleList(items, dateKey(day)));
  }
  if (upcoming.length > 0) {
    parts.push('<section>');
    parts.push('<h2>接下来 7 天</h2>');
    parts.push(...upcoming);
    parts.push('</section>');
  }

  const past = items
    .filter((item) => item.date < todayKey)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (past.length > 0) {
    parts.push(`<details><summary>已过期的日程 ${past.length} 条</summary><ul>`);
    for (const item of past.slice(0, 30)) {
      const title = typeof item.title === 'string' ? item.title : '(未命名)';
      parts.push(
        `<li><span class="time">${esc(item.date)}</span><span class="title">${esc(
          trim(title, 120),
        )}</span></li>`,
      );
    }
    parts.push('</ul></details>');
  }

  parts.push('<section>');
  parts.push('<h2>待办</h2>');
  parts.push(todoList(todos.filter((todo) => !todo.done)));
  parts.push('</section>');

  const done = todos.filter((todo) => todo.done);
  if (done.length > 0) {
    parts.push(`<details><summary>已完成 ${done.length} 项</summary>`);
    parts.push(todoList(done));
    parts.push('</details>');
  }

  parts.push('<footer>本页由本机生成的快照，静态只读。改待办或日程回 DSH 会话里说一声。</footer>');
  parts.push('</main>');
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n') + '\n';
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
  out.push('');  if (todos === null || schedule === null) {
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
  const stripHtmlStamp = (text) => text.replace(/<p class="stamp">[^<]*<\/p>/, '');
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
