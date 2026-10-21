const fs = require('fs');
const { isInside, realish } = require('../config');

// Guarda de escopo REAL (não lexical) usada pelo motor vendado: o `node --permission` e as
// checagens lexicais do MASTER comparam o caminho pedido, não o alvo resolvido — uma junction
// criada dentro da pasta permitida aponta para fora e a escrita escapa (confirmado em teste).
// Aqui o alvo é resolvido com realpath (inclusive symlinks/junctions já existentes no caminho)
// antes de aceitar. Injetado no motor via patch de manifesto (`executor/core/workspace.js`).

function assertInside(root, target, label = 'workspace da missão') {
  if (typeof root !== 'string' || typeof target !== 'string') throw new Error('assertInside: caminhos inválidos');
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    throw new Error(`assertInside: raiz inacessível: ${root}`);
  }
  // realish resolve o ancestral existente mais profundo: pega links até em arquivos que
  // ainda não existem (ex.: escrever "novo.txt" dentro de uma junction recém-criada)
  const real = realish(target);
  if (real !== realRoot && !isInside(real, realRoot)) {
    throw new Error(`caminho "${target}" resolve para fora de ${label} (link simbólico?) — bloqueado por segurança`);
  }
  return real;
}

/** Confere se dois diretórios resolvidos são o mesmo (realpath dos dois). */
function sameDir(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

module.exports = { assertInside, sameDir };
