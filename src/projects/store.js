const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths, resolveMasterDir, isInside } = require('../config');

// Registro de projetos do USUÁRIO (pastas reais da máquina escolhidas na interface). A pasta
// escolhida vira o workspace real das missões daquele projeto (`MINHAIA_PROJECT_DIR` no worker):
// a IA lê e escreve nela, e só nela. Regras de aceitação:
// - precisa existir e ser diretório; o caminho é resolvido por realpath (links resolvidos);
// - raiz de unidade (C:\) é recusada (escopo amplo demais para "projeto");
// - o MASTER é recusado (somente leitura por princípio);
// - `.secrets` (qualquer nível) é recusado (credenciais).
// Nada é apagado nem movido: remover um projeto só tira o registro, nunca toca nos arquivos.

const PROJECT_ID_RE = /^prj_[a-z0-9]{12}$/;

function registryPath() {
  return process.env.MINHAIA_PROJECTS_FILE ? path.resolve(process.env.MINHAIA_PROJECTS_FILE) : path.join(paths.DATA_DIR, 'projetos', 'projetos.json');
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    return Array.isArray(d.projects) ? d : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function save(data) {
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Valida e normaliza uma pasta escolhida pelo usuário.
 * @returns {{ok: true, path: string, name: string} | {ok: false, error: string}}
 */
function normalizeDir(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'caminho vazio' };
  if (input.includes('\0')) return { ok: false, error: 'caminho inválido' };
  let abs = path.resolve(input.trim());
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return { ok: false, error: `pasta não encontrada: ${abs}` };
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return { ok: false, error: `pasta não encontrada: ${abs}` };
  }
  if (!st.isDirectory()) return { ok: false, error: `não é uma pasta: ${abs}` };
  if (path.parse(real).root === real) return { ok: false, error: `recusado: ${real} é a raiz de uma unidade — escolha uma pasta de projeto dentro dela` };
  const master = resolveMasterDir();
  if (master && (real === master || isInside(real, master))) return { ok: false, error: 'recusado: essa pasta pertence ao MASTER (somente leitura)' };
  const parts = real.split(path.sep);
  if (parts.includes('.secrets')) return { ok: false, error: 'recusado: pasta de segredos (.secrets)' };
  return { ok: true, path: real, name: path.basename(real) || real };
}

function idFor(realPath) {
  return `prj_${crypto.createHash('sha1').update(realPath.toLowerCase()).digest('hex').slice(0, 12)}`;
}

function list() {
  return load().projects.slice().sort((a, b) => String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || '')));
}

function get(id) {
  if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) return null;
  return load().projects.find((p) => p.id === id) || null;
}

/**
 * Registra (ou reaproveita) a pasta informada. Devolve o projeto e se foi criado agora.
 * @returns {{project: any, created: boolean, reused: boolean}}
 */
function add(input) {
  const v = normalizeDir(input);
  if (v.ok === false) throw Object.assign(new Error(v.error), { status: 400 });
  const data = load();
  const id = idFor(v.path);
  let project = data.projects.find((p) => p.id === id);
  const created = !project;
  if (!project) {
    project = { id, name: v.name, path: v.path, addedAt: new Date().toISOString(), lastOpenedAt: null };
    data.projects.push(project);
  } else {
    // pasta mudou de lugar/nome? o id é o caminho real; atualiza o registro canônico
    project.name = v.name;
    project.path = v.path;
  }
  project.lastOpenedAt = new Date().toISOString();
  save(data);
  return { project, created, reused: !created };
}

function touch(id) {
  const data = load();
  const p = data.projects.find((x) => x.id === id);
  if (!p) return null;
  p.lastOpenedAt = new Date().toISOString();
  save(data);
  return p;
}

/** Remove só o REGISTRO; nunca toca nos arquivos do usuário. */
function remove(id) {
  if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) return { removed: false, reason: 'id inválido' };
  const data = load();
  const before = data.projects.length;
  data.projects = data.projects.filter((p) => p.id !== id);
  if (data.projects.length === before) return { removed: false, reason: 'projeto não encontrado' };
  save(data);
  return { removed: true };
}

module.exports = { add, list, get, remove, touch, idFor, normalizeDir, registryPath, PROJECT_ID_RE };
