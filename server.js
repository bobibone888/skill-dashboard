const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');

const SKILLS_DIRS = [
  path.resolve(process.env.HOME || process.env.USERPROFILE, '.claude/skills'),
  path.resolve(process.env.HOME || process.env.USERPROFILE, '.codex/skills'),
];
const PORT = 3456;

function parseSkillMd(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = {};
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      fmMatch[1].split('\n').forEach(line => {
        const [k, ...v] = line.split(':');
        if (k && v.length) fm[k.trim()] = v.join(':').trim().replace(/^["']|["']$/g, '');
      });
    }
    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const body = content.slice(bodyStart).trim();
    const lines = body.split('\n').filter(l => l.trim());
    const title = lines.find(l => l.startsWith('#'))?.replace(/^#+\s*/, '') || fm.name || path.basename(path.dirname(filePath));
    return { name: fm.name || title, description: fm.description || '', title, dir: path.basename(path.dirname(filePath)) };
  } catch { return null; }
}

function scanSkills() {
  const seen = new Set();
  const skills = [];
  for (const dir of SKILLS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (seen.has(e.name)) continue;
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    // Resolve symlink to check actual target exists
    const resolved = path.join(dir, e.name);
    try { fs.statSync(resolved); } catch { continue; }
      const mdPath = path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(mdPath)) continue;
      seen.add(e.name);
      const info = parseSkillMd(mdPath);
      if (info) skills.push(info);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function categorize(desc) {
  const d = desc.toLowerCase();
  if (d.includes('公众号') || d.includes('wechat')) return '公众号';
  if (d.includes('小红书') || d.includes('xhs')) return '小红书';
  if (d.includes('图') || d.includes('image') || d.includes('生图')) return '生图';
  if (d.includes('漫画') || d.includes('comic')) return '漫画';
  if (d.includes('采集') || d.includes('scrape') || d.includes('爬')) return '采集';
  return '通用';
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

const server = http.createServer((req, res) => {
  if (req.url === '/api/skills') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scanSkills().map(s => ({ ...s, category: categorize(s.description) }))));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
});

const wss = new WebSocketServer({ server });

// Watch both dirs
for (const dir of SKILLS_DIRS) {
  if (fs.existsSync(dir)) {
    chokidar.watch(dir, { depth: 1, ignoreInitial: true, followSymlinks: false }).on('all', () => {
      wss.clients.forEach(c => c.readyState === 1 && c.send('reload'));
    });
  }
}

server.listen(PORT, () => console.log(`Skill Dashboard: http://localhost:${PORT}`));
