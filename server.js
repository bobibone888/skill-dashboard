const http = require('http');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE;
const SKILLS_DIRS = [];
if (process.env.SKILLS_DIRS) {
  process.env.SKILLS_DIRS.split(';').forEach(d => { if (d.trim()) SKILLS_DIRS.push(d.trim()); });
} else if (HOME) {
  SKILLS_DIRS.push(path.resolve(HOME, '.claude/skills'));
  SKILLS_DIRS.push(path.resolve(HOME, '.codex/skills'));
}
const PORT = process.env.PORT || 3456;

function parseSkillMd(filePath) {
  try {
    let raw = fs.readFileSync(filePath, 'utf-8');
    // Strip BOM + normalize line endings
    raw = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const fm = {};
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      let ck = '', cv = '';
      fmMatch[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          if (ck) fm[ck] = cv.replace(/^["']|["']$/g, '').trim();
          ck = line.slice(0, idx).trim();
          cv = line.slice(idx + 1).trim();
        } else if (ck) {
          cv += ' ' + line.trim();
        }
      });
      if (ck) fm[ck] = cv.replace(/^["']|["']$/g, '').trim();
    }

    const bodyStart = fmMatch ? fmMatch[0].length : 0;
    const body = raw.slice(bodyStart).trim();
    const lines = body.split('\n');

    const title = lines.find(l => l.startsWith('#'))?.replace(/^#+\s*/, '') || fm.name || path.basename(path.dirname(filePath));
    const sections = lines.filter(l => /^#{2,3}\s/.test(l)).map(l => l.replace(/^#+\s*/, '')).slice(0, 12);

    // Trigger: look in body for lines containing 触发/trigger
    let trigger = '';
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      if (/触发|trigger/i.test(lines[i])) {
        const parts = [];
        for (let j = i; j < Math.min(i + 3, lines.length); j++) {
          const clean = lines[j].replace(/^[#\-*>\s]+/, '').trim();
          if (clean) parts.push(clean);
        }
        trigger = parts.join(' ').slice(0, 250);
        break;
      }
    }

    // Summary: first meaningful lines from body (non-heading, non-blank, non-frontmatter-like)
    const summaryLines = lines.filter(l => {
      const t = l.trim();
      return t && !t.startsWith('#') && !t.startsWith('---') && !/^\w+:/.test(t);
    }).slice(0, 5);
    const summary = summaryLines.join(' ').replace(/\s+/g, ' ').slice(0, 300);

    // Description: prefer frontmatter, fallback to summary
    const description = fm.description || summary || '(无描述)';

    return { name: fm.name || title, title, dir: path.basename(path.dirname(filePath)), description, trigger, sections };
  } catch (e) { return null; }
}

function scanSkills() {
  const seen = new Set();
  const skills = [];
  for (const dir of SKILLS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (seen.has(e.name)) continue;
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      try { fs.statSync(path.join(dir, e.name)); } catch { continue; }
      const mdPath = path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(mdPath)) continue;
      seen.add(e.name);
      const info = parseSkillMd(mdPath);
      if (info) skills.push(info);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function categorize(text) {
  const d = text.toLowerCase();
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
  if (req.url === '/api/skills') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    const data = scanSkills().map(s => ({ ...s, category: categorize(s.name + ' ' + s.description + ' ' + s.dir) }));
    res.end(JSON.stringify(data));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
});

server.listen(PORT, () => console.log(`Skill Dashboard: http://localhost:${PORT}\nScanning: ${SKILLS_DIRS.join(', ')}`));
