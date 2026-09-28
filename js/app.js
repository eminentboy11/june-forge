/* ═══════════════════════════════════════════════════════════════
   app.js — JUNE FORGE core
   starfield · boot · explorer · forge pipeline · versions · drift
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────── state ─────────────────────────── */
const S = {
  gh: null,
  wdp: { owner: '', repo: '' },
  xjx: { owner: '', repo: '' },
  trees: { wdp: null, xjx: null },     // Map path -> tree item
  cwd:  { wdp: '', xjx: '' },
  scan: null,                           // last forge scan
  engine: false,                        // obfuscator available?
};

/* obfuscator config — EXACT copy of ..wdp/obfuscator.js */
const OBF_OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  rotateStringArray: true,
  unicodeEscapeSequence: false,
  seed: 1337,
};
const EXCLUDE_NAMES = new Set(['.git', '.github', 'node_modules', 'June x on',
  'obfuscator.js', 'package-lock.json', '.gitignore', '.env', 'README.md', '.obfuscate-cache.json']);

const REGISTRY_PATH = '.forge/registry.json';

/* ─────────────────────────── utils ─────────────────────────── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtB = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const basename = (p) => p.split('/').pop();

function now2() { return new Date().toISOString().slice(11, 19); }
function relTime(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = (kind === 'err' ? '✖' : kind === 'ok' ? '✔' : '◈') + ' <span>' + esc(msg) + '</span>';
  $('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
}

function mlog(msg, kind = '') {
  const box = $('fg-log');
  const d = document.createElement('div');
  d.innerHTML = `<span class="t">[${now2()}]</span><span class="${kind}">${esc(msg)}</span>`;
  box.appendChild(d);
  while (box.children.length > 250) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  try { localStorage.setItem('forge.log', JSON.stringify([...box.children].slice(-200).map((x) => x.innerHTML))); } catch {}
}
(function restoreLog() {
  try {
    const arr = JSON.parse(localStorage.getItem('forge.log') || '[]');
    const box = $('fg-log');
    arr.forEach((h) => { const d = document.createElement('div'); d.innerHTML = h; box.appendChild(d); });
    box.scrollTop = box.scrollHeight;
  } catch {}
})();

async function gitBlobSha(bytes) {
  const prefix = new TextEncoder().encode('blob ' + bytes.length + '\0');
  const merged = new Uint8Array(prefix.length + bytes.length);
  merged.set(prefix); merged.set(bytes, prefix.length);
  const h = await crypto.subtle.digest('SHA-1', merged);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* limited-concurrency mapper */
async function pool(items, n, fn) {
  const q = [...items]; const runners = Array(Math.min(n, q.length)).fill(async () => {
    while (q.length) await fn(q.shift());
  });
  await Promise.all(runners.map((r) => r()));
}

/* ─────────────────────── starfield ─────────────────────────── */
(function stars() {
  const cv = $('stars'), cx = cv.getContext('2d');
  let W, H, pts = [];
  function size() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    pts = Array.from({ length: 170 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      z: Math.random() * 0.8 + 0.2, tw: Math.random() * Math.PI * 2,
    }));
  }
  size(); addEventListener('resize', size);
  (function tick(t) {
    cx.clearRect(0, 0, W, H);
    for (const p of pts) {
      p.y += p.z * 0.22; if (p.y > H) { p.y = -2; p.x = Math.random() * W; }
      const a = 0.25 + 0.45 * Math.abs(Math.sin(p.tw + t / 900));
      cx.fillStyle = `rgba(120,220,255,${(a * p.z).toFixed(3)})`;
      cx.fillRect(p.x, p.y, p.z > 0.75 ? 1.6 : 1, p.z > 0.75 ? 1.6 : 1);
    }
    requestAnimationFrame(tick);
  })(0);
})();

/* clock */
setInterval(() => { $('clock').textContent = new Date().toISOString().slice(11, 19); }, 1000);

/* ─────────────────────── boot sequence ─────────────────────── */
const BOOT_LINES = [
  ['cy', 'JUNE FORGE v1.0 — pipeline control deck'],
  ['', 'initializing quantum bus .................. OK'],
  ['ok', 'deterministic forge core ................. SEED 1337'],
  ['', 'loading ..wdp source channel ............. LINKED'],
  ['', 'loading xjx build channel ................ LINKED'],
  ['mg', 'obfuscation engine ....................... ' + (window.JavaScriptObfuscator ? 'ONLINE' : 'PROBING')],
  ['', 'github uplink ............................ AWAITING TOKEN'],
  ['cy', 'all systems nominal — welcome, operator.'],
];
(function boot() {
  const box = $('bootlog');
  BOOT_LINES.forEach(([k, txt], i) => {
    setTimeout(() => {
      const d = document.createElement('div');
      d.className = 'l ' + k;
      d.textContent = '» ' + txt;
      if (i === BOOT_LINES.length - 1) d.classList.add('bootcursor');
      box.appendChild(d);
    }, 260 * i);
  });
  setTimeout(() => { $('boot').classList.add('done'); $('app').style.visibility = 'visible'; }, 260 * BOOT_LINES.length + 500);
})();

/* ─────────────────────── panel router ──────────────────────── */
document.querySelectorAll('nav.rail button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav.rail button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('p-' + b.dataset.panel).classList.add('active');
    if (b.dataset.panel === 'versions') loadVersions();
    if (b.dataset.panel === 'workflow') loadRuns();
  });
});

/* ─────────────────────── engine probe ──────────────────────── */
function probeEngine() {
  S.engine = !!window.JavaScriptObfuscator;
  $('fg-mode').textContent = S.engine ? 'ENGINE: ONLINE · SEED 1337' : 'ENGINE: OFFLINE · RAW SHIP ONLY';
  $('fg-mode').style.color = S.engine ? 'var(--lime)' : 'var(--amber)';
  $('st-obf').innerHTML = S.engine ? '<i>ONLINE</i>' : '<i style="color:var(--amber)">CDN OFFLINE</i>';
}
window.addEventListener('load', probeEngine);
probeEngine();

/* ─────────────────────── LINK panel ────────────────────────── */
function parseRepo(s) {
  const m = s.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
  if (m.length !== 2 || !m[0] || !m[1]) return null;
  return { owner: m[0], repo: m[1] };
}

$('btn-link').addEventListener('click', async () => {
  const tok = $('in-token').value.trim();
  const w = parseRepo($('in-wdp').value), x = parseRepo($('in-xjx').value);
  if (!tok) return toast('paste a GitHub token first', 'err');
  if (!w || !x) return toast('repos must look like owner/name', 'err');

  const btn = $('btn-link'); btn.disabled = true; btn.textContent = '⟳ negotiating…';
  try {
    const gh = new ForgeGH.GitHub(tok);
    const me = await gh.me();
    S.gh = gh; S.wdp = w; S.xjx = x;

    if ($('in-remember').checked) {
      localStorage.setItem('forge.cfg', JSON.stringify({ tok, wdp: w, xjx: x }));
    }
    $('linkdot').className = 'dot ok';
    $('linktxt').textContent = 'ONLINE · ' + me.login.toUpperCase();
    $('st-user').innerHTML = '<i>' + esc(me.login) + '</i>';
    $('st-wdp').innerHTML = '<i>' + esc(w.repo) + '</i>';
    $('st-xjx').innerHTML = '<i>' + esc(x.repo) + '</i>';

    const rl = await gh.rateLimit();
    updateRate(rl.resources.core);

    toast('uplink established as ' + me.login, 'ok');
    mlog(`uplink established — operator ${me.login}`, 'ok');
    mlog(`source channel ${w.owner}/${w.repo} · build channel ${x.owner}/${x.repo}`, 'cy');

    await refreshTree('wdp');
    await refreshTree('xjx');
  } catch (e) {
    toast('uplink failed: ' + e.message, 'err');
    $('linkdot').className = 'dot err';
    $('linktxt').textContent = 'ERROR';
  } finally {
    btn.disabled = false; btn.textContent = '◈ Establish uplink';
  }
});

function updateRate(core) {
  if (!core) return;
  const pct = Math.max(0, Math.min(100, (core.remaining / core.limit) * 100));
  $('ratenum').textContent = core.remaining + '/' + core.limit;
  $('ratefill').style.width = pct + '%';
  $('ratefill').style.background = pct > 40 ? 'linear-gradient(90deg,var(--cyan),var(--lime))' : pct > 15 ? 'var(--amber)' : 'var(--red)';
}
setInterval(async () => { if (S.gh) { try { updateRate(await S.gh.rateLimit().then((r) => r.resources.core)); } catch {} } }, 60000);

/* restore saved config */
try {
  const saved = JSON.parse(localStorage.getItem('forge.cfg') || 'null');
  if (saved) {
    $('in-token').value = saved.tok || '';
    if (saved.wdp) $('in-wdp').value = saved.wdp.owner + '/' + saved.wdp.repo;
    if (saved.xjx) $('in-xjx').value = saved.xjx.owner + '/' + saved.xjx.repo;
    $('in-remember').checked = true;
    if (saved.tok) $('btn-link').click();
  }
} catch {}

/* ─────────────────────── EXPLORER ──────────────────────────── */
const sideLabel = { wdp: 'wdp', xjx: 'xjx' };

async function refreshTree(side) {
  const cfg = side === 'wdp' ? S.wdp : S.xjx;
  if (!S.gh || !cfg.owner) return;
  const t = await S.gh.tree(cfg.owner, cfg.repo, 'main');
  const map = new Map();
  for (const item of t.tree) map.set(item.path, item);
  S.trees[side] = map;
  renderDir(side);
}

function renderDir(side) {
  const cwd = S.cwd[side] || '';
  const map = S.trees[side] || new Map();
  const repoName = side === 'wdp' ? S.wdp.repo : S.xjx.repo;

  /* breadcrumb — VPS style home/container/… */
  const pb = $(side === 'wdp' ? 'path-wdp' : 'path-xjx');
  let html = `<span class="root">home/container/</span><span class="seg" data-p="">${esc(repoName)}</span><span class="sep">/</span>`;
  let acc = '';
  cwd.split('/').filter(Boolean).forEach((seg) => {
    acc += (acc ? '/' : '') + seg;
    html += `<span class="seg" data-p="${esc(acc)}">${esc(seg)}</span><span class="sep">/</span>`;
  });
  pb.innerHTML = html;
  pb.querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => { S.cwd[side] = s.dataset.p; renderDir(side); }));

  /* listing */
  const prefix = cwd ? cwd + '/' : '';
  const rows = [];
  if (cwd) rows.push({ dir: true, up: true, name: '..' });
  for (const [path, item] of map) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes('/')) continue;
    rows.push({ dir: item.type === 'tree', name: rest, size: item.size || 0, path });
  }
  rows.sort((a, b) => (!!b.up - !!a.up) || (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));

  const tb = $(side === 'wdp' ? 'tree-wdp' : 'tree-xjx');
  tb.innerHTML = rows.map((r) => {
    if (r.up) return `<tr class="dir" data-up="1"><td class="ic">↰</td><td class="nm up">..</td><td class="sz"></td></tr>`;
    const ic = r.dir ? '▸' : '·';
    const badge = r.dir ? '' : `<span class="extbadge">${esc((r.name.split('.').pop() || '?').slice(0, 5))}</span>`;
    return `<tr class="${r.dir ? 'dir' : 'file'}" data-p="${esc(r.path)}">
      <td class="ic">${ic}</td><td class="nm">${esc(r.name)}${badge}</td>
      <td class="sz">${r.dir ? '—' : fmtB(r.size)}</td></tr>`;
  }).join('');

  tb.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      if (tr.dataset.up) { S.cwd[side] = S.cwd[side].split('/').slice(0, -1).join('/'); return renderDir(side); }
      const p = tr.dataset.p;
      const item = map.get(p);
      if (item.type === 'tree') { S.cwd[side] = p; renderDir(side); }
      else openEditor(side, p, item);
    });
  });
}

/* modal editor */
let editing = null; // {side, path, sha, bytes}
async function openEditor(side, path, item) {
  const cfg = side === 'wdp' ? S.wdp : S.xjx;
  editing = { side, path, sha: item.sha };
  $('m-path').textContent = `home/container/${repoNameOf(side)}${path ? '/' + path : ''}`;
  $('m-msg').value = '';
  $('m-text').value = 'loading…';
  $('modal').classList.add('open');
  try {
    if ((item.size || 0) > 900000) { $('m-text').value = '/* file too large for in-browser editing (>900 KB) — read-only view skipped */'; return; }
    const buf = await S.gh.blob(cfg.owner, cfg.repo, item.sha);
    const text = ForgeGH.dec(new Uint8Array(buf));
    $('m-text').value = text.endsWith('\n') || !text.length ? text : text;
    editing.bytes = text;
  } catch (e) {
    $('m-text').value = '/* load failed: ' + e.message + ' */';
  }
}
function repoNameOf(side) { return side === 'wdp' ? S.wdp.repo : S.xjx.repo; }

$('m-close').addEventListener('click', () => $('modal').classList.remove('open'));
$('m-save').addEventListener('click', async () => {
  if (!editing) return;
  const cfg = editing.side === 'wdp' ? S.wdp : S.xjx;
  try {
    await S.gh.putFile(cfg.owner, cfg.repo, editing.path, $('m-text').value,
      $('m-msg').value || 'Update ' + editing.path, 'main', editing.sha);
    toast('committed ' + basename(editing.path), 'ok');
    mlog(`commit ${editing.path} → ${repoNameOf(editing.side)}@main`, 'ok');
    $('modal').classList.remove('open');
    await refreshTree(editing.side);
  } catch (e) { toast('commit failed: ' + e.message, 'err'); }
});

/* ── uploads (files + zip) ── */
function wireUpload(side) {
  const drop = $(side === 'wdp' ? 'drop-wdp' : 'drop-xjx');
  const input = $(side === 'wdp' ? 'file-wdp' : 'file-xjx');
  drop.addEventListener('click', () => input.click());
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => handleFiles(side, e.dataTransfer.files));
  input.addEventListener('change', () => handleFiles(side, input.files));
}

async function handleFiles(side, fileList) {
  if (!S.gh) return toast('establish uplink first', 'err');
  const cfg = side === 'wdp' ? S.wdp : S.xjx;
  const cwd = S.cwd[side] || '';
  const files = [];
  for (const f of fileList) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      try {
        const entries = await ForgeZip.readZip(await f.arrayBuffer());
        for (const e of entries) {
          const name = e.name.replace(/\\/g, '/');
          if (name.includes('..')) continue;
          files.push({ path: (cwd ? cwd + '/' : '') + name, data: e.data });
        }
        toast(`unpacked ${f.name} → ${entries.length} entries`, 'ok');
      } catch (e) { toast('zip failed: ' + e.message, 'err'); }
    } else {
      files.push({ path: (cwd ? cwd + '/' : '') + f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
  }
  if (!files.length) return;
  const map = new Map(files.map((f) => [f.path, f.data]));
  try {
    mlog(`upload: ${map.size} file(s) → ${repoNameOf(side)}:${cwd || '/'} …`, 'cy');
    await S.gh.commitFiles(cfg.owner, cfg.repo, 'main', map,
      `Upload ${map.size} file(s) to ${cwd || '/'} via forge`, (l) => mlog('  ' + l));
    toast(`uploaded ${map.size} file(s)`, 'ok');
    await refreshTree(side);
  } catch (e) { toast('upload failed: ' + e.message, 'err'); mlog('upload failed: ' + e.message, 'err'); }
}
wireUpload('wdp'); wireUpload('xjx');

/* ─────────────────────── FORGE ─────────────────────────────── */
function sourceFilter(treeMap) {
  /* replicate ..wdp/obfuscator.js traversal rules */
  const jobs = [];
  for (const [path, item] of treeMap) {
    if (item.type !== 'blob') continue;
    if (EXCLUDE_NAMES.has(basename(path))) continue;
    jobs.push({ path, sha: item.sha, size: item.size || 0, js: path.toLowerCase().endsWith('.js') });
  }
  return jobs;
}

$('btn-scan').addEventListener('click', async () => {
  if (!S.gh) return toast('establish uplink first', 'err');
  try {
    mlog('scanning ' + S.wdp.repo + '@main …', 'cy');
    if (!S.trees.wdp) await refreshTree('wdp');
    const jobs = sourceFilter(S.trees.wdp);
    const js = jobs.filter((j) => j.js);
    S.scan = jobs;
    const bytes = jobs.reduce((a, j) => a + j.size, 0);
    $('fg-scan').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">JS files → obfuscate</div><div class="v"><i>${js.length}</i></div></div>
        <div class="stat"><div class="k">Copied verbatim</div><div class="v">${jobs.length - js.length}</div></div>
        <div class="stat"><div class="k">Total payload</div><div class="v">${fmtB(bytes)}</div></div>
        <div class="stat"><div class="k">Determinism</div><div class="v"><i style="color:var(--lime)">SEED 1337</i></div></div>
      </div>`;
    mlog(`scan complete — ${js.length} js to forge, ${jobs.length - js.length} verbatim, ${fmtB(bytes)}`, 'ok');
  } catch (e) { mlog('scan failed: ' + e.message, 'err'); toast(e.message, 'err'); }
});

$('btn-forge').addEventListener('click', async () => {
  if (!S.gh) return toast('establish uplink first', 'err');
  if (!window.JavaScriptObfuscator) return toast('obfuscator engine offline (CDN blocked) — reload with network or ship raw via explorer', 'err');
  const btn = $('btn-forge'); btn.disabled = true;
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 5);
  const msg = $('fg-msg').value.trim() || 'Update build';
  const tag = 'forge/' + id;
  try {
    mlog(`⚒ FORGE STRIKE ${id} initiated`, 'mg');
    const t0 = Date.now();
    const el = () => `[+${Math.round((Date.now() - t0) / 1000)}s]`;
    if (!S.trees.wdp) await refreshTree('wdp');
    if (!S.trees.xjx) await refreshTree('xjx');
    const jobs = S.scan || sourceFilter(S.trees.wdp);

    /* 1 — pull all source blobs (10-wide, auto-retry) */
    mlog(`PHASE 1 · acquiring ${jobs.length} source files ${el()}`, 'cy');
    const blobs = new Map();
    let done = 0;
    await pool(jobs, 10, async (j) => {
      const buf = new Uint8Array(await S.gh.blob(S.wdp.owner, S.wdp.repo, j.sha));
      blobs.set(j.path, buf);
      if (++done % 50 === 0) mlog(`  pulled ${done}/${jobs.length} ${el()}`);
    });
    mlog(`source acquired — ${fmtB([...blobs.values()].reduce((a, b) => a + b.length, 0))}`, 'ok');

    /* 2 — commit source to wdp (changed-only, vs current tree) */
    const changedSrc = new Map();
    for (const [p, bytes] of blobs) {
      const old = S.trees.wdp.get(p);
      if (!old || (await gitBlobSha(bytes)) !== old.sha) changedSrc.set(p, bytes);
    }
    let wdpSha = await S.gh.branchHead(S.wdp.owner, S.wdp.repo, 'main');
    if (changedSrc.size) {
      mlog(`PHASE 2 · open source → ${S.wdp.repo} (${changedSrc.size} changed) ${el()}`, 'cy');
      wdpSha = await S.gh.commitFiles(S.wdp.owner, S.wdp.repo, 'main', changedSrc, msg, (l) => mlog('  ' + l));
    } else mlog('source identical — no wdp commit needed', 'wn');

    /* 3 — tag the build on wdp */
    await S.gh.createTag(S.wdp.owner, S.wdp.repo, tag, `${msg} (forge ${id})`, wdpSha);
    mlog(`tagged ${tag} @ ${wdpSha.slice(0, 7)}`, 'ok');

    /* 4 — forge the build */
    const build = new Map();
    let obfDone = 0;
    mlog(`PHASE 3 · forging with seed 1337 ${el()}`, 'mg');
    for (const j of jobs) {
      if (j.js) {
        const src = ForgeGH.dec(blobs.get(j.path));
        let out;
        try {
          out = window.JavaScriptObfuscator.obfuscate(src, OBF_OPTS).getObfuscatedCode();
        } catch (e) {
          mlog(`  ⚠ obfuscation failed for ${j.path} — shipping raw (${e.message})`, 'wn');
          out = src;
        }
        build.set(j.path, ForgeGH.enc(out));
      } else {
        build.set(j.path, blobs.get(j.path));
      }
      if (++obfDone % 40 === 0) mlog(`  forged ${obfDone}/${jobs.length}`);
    }
    mlog(`build complete — ${build.size} files`, 'ok');

    /* 5 — commit build to xjx (changed-only) */
    const changedBuild = new Map();
    for (const [p, bytes] of build) {
      const old = S.trees.xjx.get(p);
      if (!old || (await gitBlobSha(bytes)) !== old.sha) changedBuild.set(p, bytes);
    }
    let xjxSha;
    if (changedBuild.size) {
      mlog(`PHASE 4 · build → ${S.xjx.repo} (${changedBuild.size} changed) ${el()}`, 'cy');
      xjxSha = await S.gh.commitFiles(S.xjx.owner, S.xjx.repo, 'main', changedBuild, msg, (l) => mlog('  ' + l));
    } else {
      xjxSha = await S.gh.branchHead(S.xjx.owner, S.xjx.repo, 'main');
      mlog('build byte-identical to what xjx already ships — no push needed', 'wn');
    }

    /* 6 — registry update */
    const reg = await readRegistry();
    reg.live = id;
    reg.builds = (reg.builds || []).filter((b) => b.id !== id);
    reg.builds.unshift({
      id, time: new Date().toISOString(), msg,
      tag, wdpSha, xjxSha,
      js: jobs.filter((j) => j.js).length,
      copied: jobs.length - jobs.filter((j) => j.js).length,
      operator: $('st-user').textContent || 'operator',
      replay: 0,
    });
    reg.builds = reg.builds.slice(0, 60);
    await S.gh.commitFiles(S.xjx.owner, S.xjx.repo, 'main',
      new Map([[REGISTRY_PATH, ForgeGH.enc(JSON.stringify(reg, null, 2))]]),
      `forge registry → ${id}`, (l) => mlog('  ' + l));

    mlog(`✔ STRIKE ${id} COMPLETE — xjx now ships this build`, 'ok');
    toast('FORGE COMPLETE — shipped to both repos', 'ok');
    await refreshTree('wdp'); await refreshTree('xjx');
  } catch (e) {
    mlog('✖ strike aborted: ' + e.message, 'err');
    toast('forge failed: ' + e.message, 'err');
  } finally { btn.disabled = false; }
});

async function readRegistry() {
  try {
    const item = S.trees.xjx && S.trees.xjx.get(REGISTRY_PATH);
    if (!item) return { live: null, builds: [] };
    const buf = new Uint8Array(await S.gh.blob(S.xjx.owner, S.xjx.repo, item.sha));
    return JSON.parse(ForgeGH.dec(buf));
  } catch { return { live: null, builds: [] }; }
}

/* ─────────────────────── VERSIONS ──────────────────────────── */
async function loadVersions() {
  if (!S.gh) return;
  const box = $('vlist');
  try {
    if (!S.trees.xjx) await refreshTree('xjx');
    const reg = await readRegistry();
    const regIds = new Set((reg.builds || []).map((b) => b.id));

    /* tags are the real source of truth — registry can lag if a strike stalls */
    const orphans = [];
    try {
      const tags = await S.gh.listTags(S.wdp.owner, S.wdp.repo);
      for (const t of tags) {
        const m = (t.name || '').match(/^forge\/(\d{14}-[a-z0-9]{3,5})$/);
        if (m && !regIds.has(m[1])) orphans.push(m[1]);
      }
    } catch {}

    if ((!reg.builds || !reg.builds.length) && !orphans.length) { box.innerHTML = '<div class="kv"><span>no builds yet — run a FORGE strike first</span></div>'; return; }
    box.innerHTML = reg.builds.map((b) => `
      <div class="vcard ${reg.live === b.id ? 'live' : ''}">
        <div class="vtag">${esc(b.id)}</div>
        <div class="vmeta">
          ${esc(b.msg)} · <b>${b.js}</b> forged / <b>${b.copied}</b> copied${b.replay ? ` · replayed ×${b.replay}` : ''}<br>
          ${esc(b.time.slice(0, 16).replace('T', ' '))} UTC · wdp <b>${esc((b.wdpSha || '').slice(0, 7))}</b> · xjx <b>${esc((b.xjxSha || '').slice(0, 7))}</b> · ${esc(b.operator || '')}
        </div>
        <div>
          ${reg.live === b.id ? '<span class="livechip">◉ LIVE</span>' : `<button class="btn sm" data-act="${esc(b.id)}">⟲ ACTIVATE</button>`}
        </div>
      </div>`).join('')
      + orphans.map((id) => `
      <div class="vcard">
        <div class="vtag">${esc(id)}</div>
        <div class="vmeta"><span style="color:var(--amber)">◈ orphan strike — registry never landed</span><br>
        fully recoverable: replay from tag <b>forge/${esc(id)}</b> on wdp</div>
        <div><button class="btn sm" data-act="${esc(id)}">⟲ RECOVER</button></div>
      </div>`).join('');
    box.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => activate(btn.dataset.act)));
  } catch (e) { box.innerHTML = `<div class="kv"><span style="color:var(--red)">${esc(e.message)}</span></div>`; }
}
$('btn-versions').addEventListener('click', loadVersions);

/* replay a historic build byte-identically onto xjx */
async function activate(id) {
  if (!window.JavaScriptObfuscator) return toast('engine offline — cannot replay (CDN needed)', 'err');
  const btn = document.querySelector(`[data-act="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⟳ replaying…'; }
  try {
    mlog(`⟲ ACTIVATE ${id} — deterministic replay`, 'mg');
    const reg = await readRegistry();
    let b = reg.builds.find((x) => x.id === id);
    if (!b) {
      /* registry never landed (stall/closed page) — recover straight from the tag */
      b = { id, tag: 'forge/' + id, msg: `recovered from tag forge/${id}`,
            time: new Date().toISOString(), operator: 'tag-recovery', replay: 0 };
    }

    /* tree at tag */
    const tagRef = await S.gh.api(`/repos/${S.wdp.owner}/${S.wdp.repo}/git/ref/tags/${encodeURIComponent(b.tag)}`);
    const tagSha = tagRef.object.sha;
    const t = await S.gh.tree(S.wdp.owner, S.wdp.repo, tagSha);
    const map = new Map();
    for (const it of t.tree) if (it.type === 'blob') map.set(it.path, it);
    const jobs = sourceFilter(map);

    const blobs = new Map();
    await pool(jobs, 10, async (j) => blobs.set(j.path, new Uint8Array(await S.gh.blob(S.wdp.owner, S.wdp.repo, j.sha))));

    const build = new Map();
    for (const j of jobs) {
      if (j.js) {
        let out;
        try { out = window.JavaScriptObfuscator.obfuscate(ForgeGH.dec(blobs.get(j.path)), OBF_OPTS).getObfuscatedCode(); }
        catch { out = ForgeGH.dec(blobs.get(j.path)); }
        build.set(j.path, ForgeGH.enc(out));
      } else build.set(j.path, blobs.get(j.path));
    }

    if (!S.trees.xjx) await refreshTree('xjx');
    const changed = new Map();
    for (const [p, bytes] of build) {
      const old = S.trees.xjx.get(p);
      if (!old || (await gitBlobSha(bytes)) !== old.sha) changed.set(p, bytes);
    }
    let xjxSha;
    if (changed.size) {
      mlog(`replay differs from current xjx — pushing ${changed.size} file(s) …`, 'cy');
      xjxSha = await S.gh.commitFiles(S.xjx.owner, S.xjx.repo, 'main', changed,
        `Activate ${id} (deterministic replay)`, (l) => mlog('  ' + l));
    } else {
      xjxSha = await S.gh.branchHead(S.xjx.owner, S.xjx.repo, 'main');
      mlog('current xjx already byte-identical to this version', 'wn');
    }

    reg.live = id;
    let entry = reg.builds.find((x) => x.id === id);
    if (!entry) { entry = b; reg.builds.unshift(entry); }
    entry.xjxSha = xjxSha; entry.replay = (entry.replay || 0) + 1;
    await S.gh.commitFiles(S.xjx.owner, S.xjx.repo, 'main',
      new Map([[REGISTRY_PATH, ForgeGH.enc(JSON.stringify(reg, null, 2))]]),
      `forge registry → live ${id}`);
    mlog(`✔ ${id} is now LIVE on ${S.xjx.repo}`, 'ok');
    toast(`${id} activated on xjx`, 'ok');
    await refreshTree('xjx');
    loadVersions();
  } catch (e) {
    mlog('✖ activate failed: ' + e.message, 'err');
    toast('activate failed: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '⟲ ACTIVATE'; }
  }
}

/* ─────────────────────── DRIFT ─────────────────────────────── */
$('btn-drift').addEventListener('click', async () => {
  if (!S.gh) return toast('establish uplink first', 'err');
  const out = $('drift-out');
  out.innerHTML = '<div class="kv"><span>comparing …</span></div>';
  try {
    if (!S.trees.wdp) await refreshTree('wdp');
    if (!S.trees.xjx) await refreshTree('xjx');
    const src = sourceFilter(S.trees.wdp);

    let missing = [], verbatimMismatch = 0, verbatimOk = 0, extra = 0;
    const srcPaths = new Set(src.map((j) => j.path));
    for (const j of src) {
      const b = S.trees.xjx.get(j.path);
      if (!b) { missing.push(j.path); continue; }
      if (!j.js) { if (b.sha !== j.sha) verbatimMismatch++; else verbatimOk++; }
    }
    for (const p of S.trees.xjx.keys()) {
      if (!srcPaths.has(p) && p !== REGISTRY_PATH && !p.startsWith('.forge/')) extra++;
    }

    /* recency */
    const [cw, cx2] = await Promise.all([
      S.gh.api(`/repos/${S.wdp.owner}/${S.wdp.repo}/commits/main`),
      S.gh.api(`/repos/${S.xjx.owner}/${S.xjx.repo}/commits/main`),
    ]);

    const checks = src.length - missing.length;
    const presence = checks ? ((checks / src.length) * 100) : 0;
    const verbatimTotal = verbatimOk + verbatimMismatch;
    const vPct = verbatimTotal ? (verbatimOk / verbatimTotal) * 100 : 100;
    const stale = new Date(cw.commit.committer.date) > new Date(cx2.commit.committer.date);

    out.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Presence</div><div class="v"><i>${presence.toFixed(1)}%</i></div></div>
        <div class="stat"><div class="k">Verbatim copy match</div><div class="v"><i>${vPct.toFixed(1)}%</i></div></div>
        <div class="stat"><div class="k">wdp last commit</div><div class="v" style="font-size:13px">${relTime(cw.commit.committer.date)}</div></div>
        <div class="stat"><div class="k">xjx last commit</div><div class="v" style="font-size:13px">${relTime(cx2.commit.committer.date)}</div></div>
      </div>
      <div class="kv"><span>files missing on xjx</span><b style="color:${missing.length ? 'var(--red)' : 'var(--lime)'}">${missing.length}</b></div>
      <div class="meter"><i class="${missing.length ? (missing.length > 10 ? 'err' : 'warn') : 'ok'}" style="width:${100 - Math.min(100, missing.length)}%"></i></div>
      <div class="kv"><span>non-JS files drifted (should be identical copies)</span><b style="color:${verbatimMismatch ? 'var(--amber)' : 'var(--lime)'}">${verbatimMismatch}</b></div>
      <div class="kv"><span>extra files on xjx (not in source)</span><b>${extra}</b></div>
      <div class="kv"><span>source newer than build (workflow lag)</span><b style="color:${stale ? 'var(--red)' : 'var(--lime)'}">${stale ? 'YES — xjx is behind' : 'no'}</b></div>
      ${stale ? '<div class="kv" style="margin-top:8px"><span style="color:var(--magenta)">▸ recommendation:</span><b>run a FORGE strike — it bypasses the broken workflow entirely</b></div>' : ''}
      ${missing.length ? `<div class="kv" style="margin-top:6px"><span>first missing:</span><b>${esc(missing.slice(0, 6).join(', '))}${missing.length > 6 ? ` +${missing.length - 6} more` : ''}</b></div>` : ''}
    `;
    mlog(`drift check — missing:${missing.length} verbatim-drift:${verbatimMismatch} stale:${stale}`, missing.length || stale ? 'wn' : 'ok');
  } catch (e) {
    out.innerHTML = `<div class="kv"><span style="color:var(--red)">${esc(e.message)}</span></div>`;
  }
});

/* ─────────────────────── WORKFLOW ──────────────────────────── */
async function loadRuns() {
  if (!S.gh) return;
  const out = $('runs-out');
  out.innerHTML = '<div class="kv"><span>reading runs …</span></div>';
  try {
    const runs = await S.gh.workflowRuns(S.wdp.owner, S.wdp.repo);
    if (!runs.length) { out.innerHTML = '<div class="kv"><span>no workflow runs found on the source repo</span></div>'; return; }
    out.innerHTML = runs.map((r) => {
      const chip = r.conclusion === 'success' ? '<span class="chip ok">SUCCESS</span>'
        : r.conclusion === 'failure' ? '<span class="chip err">FAILED</span>'
        : r.conclusion === 'cancelled' ? '<span class="chip wn">CANCELLED</span>'
        : r.conclusion ? `<span class="chip wn">${esc(r.conclusion).toUpperCase()}</span>`
        : '<span class="chip cy">RUNNING</span>';
      return `<div class="run">
        <span class="dot ${r.conclusion === 'success' ? 'ok' : r.conclusion && r.conclusion !== 'success' ? 'err' : 'warn'}"></span>
        <div><div class="rname">${esc(r.name || 'workflow')} · ${esc(r.path || '')}</div>
        <div class="rsha">${esc(r.head_sha.slice(0, 7))} · ${esc(r.head_branch || '')} · run ${r.run_number} · ${esc(r.event || '')}</div></div>
        <span class="rtime">${relTime(r.created_at)}</span>
        ${chip} ${r.conclusion && r.conclusion !== 'success' ? `<button class="btn sm" data-rerun="${r.id}">↻ RERUN</button>` : ''}
      </div>`;
    }).join('');
    out.querySelectorAll('[data-rerun]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await S.gh.rerunRun(S.wdp.owner, S.wdp.repo, b.dataset.rerun);
        toast('re-run dispatched', 'ok');
        setTimeout(loadRuns, 1500);
      } catch (e) { toast('rerun failed: ' + e.message, 'err'); }
    }));
  } catch (e) {
    out.innerHTML = `<div class="kv"><span style="color:var(--red)">${esc(e.message)}</span></div>`;
  }
}
$('btn-runs').addEventListener('click', loadRuns);

/* esc closes modal */
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').classList.remove('open'); });
