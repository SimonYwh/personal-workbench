// 生成「个人工作台」快照：把待办、日程、团队动态写成 README.md + data/*.json
// 由 sync.ps1 定时调用；不写回插件数据，只读。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = 'C:/Users/ywh/.dsh/profiles/desktop/created-plugins/4de8b7d5-b20f-40cd-8f17-39d64f1f0a98';
const DATA_DIR = join(PLUGIN, 'data');
const TEAM_STATUS = 'D:/MASTER/research-team/shared/STATUS.md';
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

async function teamLines() {
  try {
    const raw = await readFile(TEAM_STATUS, 'utf8');
    const lines = raw.replace(/\r/g, '').split('\n');
    const picked = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('```') || trimmed.startsWith('|---')) continue;
      const bare = trimmed.replace(/^[-*+]\s+/, '').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
      if (bare === '' || bare.length < 6) continue;
      if (/^(Generated|Generation|Each task|Task|Project|Owner|Status|Snapshot|Index|Updated|Revision|Source|Conclusions?|Summary|Details|Notes)\b\s*[::]?/i.test(bare)) continue;
      if (/^\[.*\]\(.*\)$/.test(bare)) continue;
      picked.push(trim(bare, 110));
      if (picked.length >= 5) break;
    }
    return picked;
  } catch {
    return null;
  }
}

async function main() {
  const now = new Date();
  const todos = await readJsonList(join(DATA_DIR, 'todos.json'));
  const schedule = await readJsonList(join(DATA_DIR, 'schedule.json'));
  const team = await teamLines();
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

  out.push('## 团队动态');
  out.push('');
  if (team === null) {
    out.push('- （读不到 research-team 状态文件）');
  } else if (team.length === 0) {
    out.push('- （状态文件暂无内容）');
  } else {
    out.push(...team.map((line) => `- ${line}`));
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('> 这份文件由本机手动同步生成并推送到这个私有仓库，手机上打开仓库就是上面的内容。');
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
  console.log(`ok ${dateKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} open=${open.length} done=${done.length} schedule=${filteredSchedule.length} changed=${changed}`);
}

main().catch((error) => {
  console.error('gen failed:', error);
  process.exitCode = 1;
});
