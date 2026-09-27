/* ═══════════════════════════════════════════════════════════════
   gh.js — GitHub REST client for JUNE FORGE (100% client-side)
   Trees · Blobs · Commits · Refs · Tags · Contents · Actions
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = 'https://api.github.com';

  class GitHub {
    constructor(token) {
      this.token = token;
      this.remaining = null;
      this.limit = null;
    }

    headers(extra = {}) {
      const h = {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...extra,
      };
      return h;
    }

    async api(path, opts = {}) {
      const h = {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.rawHeaders || {}),
      };
      if (opts.body && !opts.raw) h['Content-Type'] = 'application/json';
      const res = await fetch(API + path, {
        method: opts.method || 'GET',
        headers: h,
        body: opts.body && !opts.raw ? JSON.stringify(opts.body) : opts.body,
      });
      const lim = res.headers.get('x-ratelimit-remaining');
      if (lim !== null) { this.remaining = +lim; this.limit = +(res.headers.get('x-ratelimit-limit') || 0); }
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { const j = await res.json(); if (j.message) msg += ` — ${j.message}`; } catch {}
        const e = new Error(msg);
        e.status = res.status;
        throw e;
      }
      if (res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.arrayBuffer();
    }

    /* ── identity & limits ─────────────────────────────── */
    me() { return this.api('/user'); }
    rateLimit() { return this.api('/rate_limit'); }

    /* ── refs / trees / blobs ──────────────────────────── */
    async branchHead(owner, repo, branch = 'main') {
      const r = await this.api(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
      return r.commit.sha;
    }

    async tree(owner, repo, ref, recursive = true) {
      const r = await this.api(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}${recursive ? '?recursive=1' : ''}`);
      return r; // { sha, tree:[{path,mode,type,sha,size}], truncated }
    }

    async blob(owner, repo, sha) {
      // raw arraybuffer
      return this.api(`/repos/${owner}/${repo}/git/blobs/${sha}`, { raw: true, rawHeaders: { 'Accept': 'application/vnd.github.raw' } });
    }

    async createBlob(owner, repo, content) {
      const body = typeof content === 'string'
        ? { content: btoa(unescape(encodeURIComponent(content))), encoding: 'base64' }
        : { content: ForgeGH.bytesToB64(content), encoding: 'base64' };
      const r = await this.api(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body });
      return r.sha;
    }

    async createTree(owner, repo, baseTree, entries) {
      // entries: [{ path, sha? , content? , mode?, type? }]
      const r = await this.api(`/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        body: { base_tree: baseTree, tree: entries },
      });
      return r.sha;
    }

    async createCommit(owner, repo, message, treeSha, parents) {
      const r = await this.api(`/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        body: { message, tree: treeSha, parents },
      });
      return r.sha;
    }

    async updateRef(owner, repo, ref, sha) {
      return this.api(`/repos/${owner}/${repo}/git/refs/${ref}`, { method: 'PATCH', body: { sha } });
    }

    async createTag(owner, repo, tag, message, sha) {
      // annotated tag object then a ref under refs/tags/<tag>
      const t = await this.api(`/repos/${owner}/${repo}/git/tags`, {
        method: 'POST',
        body: { tag, message, object: sha, type: 'commit' },
      });
      await this.api(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: t.sha } });
      return t.sha;
    }

    async listTags(owner, repo) { return this.api(`/repos/${owner}/${repo}/tags?per_page=100`); }

    /* ── contents (single-file ops) ────────────────────── */
    async getFile(owner, repo, path, ref = 'main') {
      return this.api(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
    }

    async putFile(owner, repo, path, content, message, branch = 'main', sha = undefined) {
      const body = {
        message,
        branch,
        content: typeof content === 'string'
          ? btoa(unescape(encodeURIComponent(content)))
          : ForgeGH.bytesToB64(content),
      };
      if (sha) body.sha = sha;
      return this.api(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body });
    }

    /* ── multi-file atomic commit (blobs→tree→commit→ref) ── */
    async commitFiles(owner, repo, branch, files, message, log = () => {}) {
      // files: Map<'path', Uint8Array | string>
      const head = await this.branchHead(owner, repo, branch);
      log(`base ${branch}@${head.slice(0, 7)}`);

      const entries = [];
      let done = 0;
      for (const [path, content] of files) {
        const sha = await this.createBlob(owner, repo, content);
        entries.push({ path, sha, mode: '100644', type: 'blob' });
        done++;
        if (done % 25 === 0 || done === files.size) log(`blobs ${done}/${files.size}`);
      }

      const treeSha = await this.createTree(owner, repo, head, entries);
      log(`tree ${treeSha.slice(0, 7)} (${entries.length} paths)`);

      const commitSha = await this.createCommit(owner, repo, message, treeSha, [head]);
      await this.updateRef(owner, repo, `heads/${branch}`, commitSha);
      log(`commit ${commitSha.slice(0, 7)} pushed → ${branch}`);
      return commitSha;
    }

    /* ── actions (workflow monitor) ────────────────────── */
    async workflowRuns(owner, repo, perPage = 12) {
      const r = await this.api(`/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`);
      return r.workflow_runs || [];
    }

    async rerunRun(owner, repo, runId) {
      return this.api(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, { method: 'POST' });
    }
  }

  /* ── helpers ──────────────────────────────────────────── */
  const ForgeGH = {
    GitHub,
    bytesToB64(bytes) {
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return btoa(bin);
    },
    b64ToBytes(b64) {
      const bin = atob(b64.replace(/\n/g, ''));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    },
    enc(s) { return new TextEncoder().encode(s); },
    dec(b) { return new TextDecoder().decode(b); },
  };

  window.ForgeGH = ForgeGH;
})();
