const test = require('node:test');
const assert = require('node:assert/strict');
const { withSelectedModel } = require('../src/models/override');
const catalog = require('../src/models/catalog');

test('seleção manual prioriza o candidato elegível e preserva fallback ordenado', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
  const result = withSelectedModel({ escolhido: a, ordemFallback: [a, b, c], motivo: 'ranking' }, 'b');
  assert.equal(result.escolhido, b);
  assert.deepEqual(result.ordemFallback, [b, a, c]);
  assert.match(result.motivo, /modelo selecionado pelo usuário/);
});

test('seleção manual incompatível falha sem escolher silenciosamente outro modelo', () => {
  const a = { id: 'a' };
  const result = withSelectedModel({ escolhido: a, ordemFallback: [a], motivo: 'nenhum candidato' }, 'fora-da-lista');
  assert.equal(result.escolhido, null);
  assert.deepEqual(result.ordemFallback, []);
  assert.match(result.motivo, /não é compatível/);
});

test('catálogo só expõe modelos textuais free e marca disponibilidade sem revelar credenciais', () => {
  const models = catalog.list();
  assert.ok(models.length > 0);
  for (const model of models) {
    assert.ok(model.id && model.provider && model.model);
    assert.equal(typeof model.available, 'boolean');
    assert.equal(model.reasoningEffort, false, 'não existe transmissão de esforço para o provedor');
    assert.ok(!JSON.stringify(model).match(/(sk-[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})/));
  }
});
