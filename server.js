const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');

const HOME = process.env.HOME || process.env.USERPROFILE;
const SKILLS_DIRS = HOME ? [
  path.resolve(HOME, '.claude/skills'),
  path.resolve(HOME, '.codex/skills'),
] : [];
if (process.env.SKILLS_DIRS) {
  SKILLS_DIRS.length = 0;
  process.env.SKILLS_DIRS.split(';').forEach(d => SKILLS_DIRS.push(d.trim()));
}
const PORT = process.env.PORT || 3456;

function parseSkillMd(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = {};
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      fmMatch[1].split("\n").forEach(line => {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          if (k && val) fm[k] = val;
        }
      });
    }
    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const body = content.slice(bodyStart).trim();
    const lines = body.split('\n').filter(l => l.trim());
    const title = lines.find(l => l.startsWith('#'))?.replace(/^#+\s*/, '') || fm.name || path.basename(path.dirname(filePath));
    // Extract summary: first 5 non-heading non-empty lines
    const summaryLines = lines.filter(l => !l.startsWith('#')).slice(0, 5);
    return {
      name: fm.name || title,
      description: fm.description || '',
      title,
      dir: path.basename(path.dirname(filePath)),
      summary: summaryLines.join('\n')
    };
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

function categorize(nameAndDesc) {
  const d = nameAndDesc.toLowerCase();
  if (d.includes('公众号') || d.includes('wechat')) return '公众号';
  if (d.includes('小红书') || d.includes('xhs') || d.includes('xiaohongshu')) return '小红书';
  if (d.includes('生图') || d.includes('image-gen') || d.includes('mify')) return '生图';
  if (d.includes('漫画') || d.includes('comic')) return '漫画';
  if (d.includes('采集') || d.includes('scrape') || d.includes('爬')) return '采集';
  if (d.includes('debug') || d.includes('android') || d.includes('flutter')) return '开发调试';
  return '通用';
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/skill/')) {
    const name = decodeURIComponent(req.url.split('/api/skill/')[1]);
    let content = '';
    for (const dir of SKILLS_DIRS) {
      const p = path.join(dir, name, 'SKILL.md');
      try { content = fs.readFileSync(p, 'utf-8'); break; } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content || 'SKILL.md not found');
    return;
  }
  if (req.url === '/api/skills') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const data = scanSkills().map(s => ({
      ...s,
      category: categorize(s.name + ' ' + s.description + ' ' + s.dir)
    }));
    res.end(JSON.stringify(data));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
});

const wss = new WebSocketServer({ server });
for (const dir of SKILLS_DIRS) {
  if (fs.existsSync(dir)) {
    chokidar.watch(dir, { depth: 1, ignoreInitial: true, followSymlinks: false }).on('all', () => {
      wss.clients.forEach(c => c.readyState === 1 && c.send('reload'));
    });
  }
}

server.listen(PORT, () => console.log(`Skill Dashboard: http://localhost:${PORT}\nScanning: ${SKILLS_DIRS.join(', ')}`));
