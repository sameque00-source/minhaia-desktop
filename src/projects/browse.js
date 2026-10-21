const fs = require('fs');
const path = require('path');
const { isInside } = require('../config');

// Navegação do projeto escolhido pelo usuário (listar arquivos, ler conteúdo, buscar por nome).
// Toda resolução de caminho passa por realpath e confinamento: nem `..` nem link simbólico que
// escape da pasta do projeto são aceitos — mesmo critério da guarda do motor (scope.js).

const MAX_FILE_BYTES = 256 * 1024;
const MAX_DIR_ENTRIES = 2000;
const MAX_SEARCH_HITS = 100;
const MAX_SEARCH_SCAN = 50000;
const IGNORE_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.venv', 'venv', '__pycache__', '.tox', '.cache', 'coverage', 'dist', 'build', 'out', '.next', 'target']);

function notFound(msg) {
  return Object.assign(new Error(msg), { status: 404 });
}

function rootOf(project) {
  if (!fs.existsSync(project.path)) throw notFound('a pasta do projeto não existe mais');
  return fs.realpathSync(project.path);
}

/** @returns {{abs: string, real: string, rel: string} | null} */
function resolveWithin(root, relPath, { mustExist = true } = {}) {
  if (typeof relPath !== 'string' || relPath.includes('\0')) return null;
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = cleaned ? path.resolve(root, cleaned) : root;
  if (target !== root && !isInside(target, root)) return null;
  if (!fs.existsSync(target)) return mustExist ? null : { abs: target, real: target, rel: cleaned };
  const real = fs.realpathSync(target);
  if (real !== root && !isInside(real, root)) return null;
  return { abs: target, real, rel: cleaned };
}

/** Lista um diretório (um nível): dirs primeiro, depois arquivos, ordem alfabética. */
function listDir(project, relPath = '') {
  const root = rootOf(project);
  const r = resolveWithin(root, relPath);
  if (!r) throw notFound(`caminho não encontrado: ${relPath || '.'}`);
  const st = fs.statSync(r.real);
  if (!st.isDirectory()) throw notFound(`não é uma pasta: ${relPath}`);
  const entries = [];
  for (const ent of fs.readdirSync(r.real, { withFileTypes: true })) {
    if (entries.length >= MAX_DIR_ENTRIES) break;
    if (ent.isSymbolicLink()) continue; // links não são navegáveis (podem escapar do projeto)
    const childRel = r.rel ? `${r.rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) entries.push({ name: ent.name, path: childRel, dir: true, ignored: IGNORE_DIRS.has(ent.name) });
    else if (ent.isFile()) {
      let bytes = null;
      let modifiedAt = null;
      try {
        const s = fs.statSync(path.join(r.real, ent.name));
        bytes = s.size;
        modifiedAt = s.mtime.toISOString();
      } catch { /* corrida com remoção: mantém nulos */ }
      entries.push({ name: ent.name, path: childRel, dir: false, bytes, modifiedAt });
    }
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'pt-BR') : a.dir ? -1 : 1));
  return { path: r.rel, entries };
}

function readFile(project, relPath) {
  const root = rootOf(project);
  const r = resolveWithin(root, relPath);
  if (!r || !fs.statSync(r.real).isFile()) throw notFound(`arquivo não encontrado: ${relPath}`);
  const size = fs.statSync(r.real).size;
  if (size > MAX_FILE_BYTES) throw Object.assign(new Error(`arquivo com ${size} bytes (limite ${MAX_FILE_BYTES})`), { status: 413 });
  const buf = fs.readFileSync(r.real);
  const binary = buf.includes(0);
  return { status: 200, path: r.rel, bytes: size, binary, content: binary ? null : buf.toString('utf8') };
}

/** Busca por NOME (substring, case-insensitive) no caminho relativo; não lê conteúdo. */
function searchNames(project, query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) throw Object.assign(new Error('busca precisa de pelo menos 2 caracteres'), { status: 400 });
  const root = rootOf(project);
  const hits = [];
  let scanned = 0;
  const stack = [''];
  while (stack.length && hits.length < MAX_SEARCH_HITS && scanned < MAX_SEARCH_SCAN) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned += 1;
      if (scanned > MAX_SEARCH_SCAN || hits.length >= MAX_SEARCH_HITS) break;
      if (ent.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!IGNORE_DIRS.has(ent.name)) stack.push(childRel);
        continue;
      }
      if (childRel.toLowerCase().includes(q)) {
        let bytes = null;
        try { bytes = fs.statSync(path.join(root, childRel)).size; } catch { /* removido na corrida */ }
        hits.push({ path: childRel, bytes });
      }
    }
  }
  return { query: String(query), hits, truncated: hits.length >= MAX_SEARCH_HITS || scanned >= MAX_SEARCH_SCAN, scanned };
}

module.exports = { listDir, readFile, searchNames, resolveWithin, IGNORE_DIRS, MAX_FILE_BYTES };
