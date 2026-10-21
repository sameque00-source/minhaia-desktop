'use strict';

/** Prioriza o modelo explicitamente escolhido sem retirar do roteador a gestão de fallback. */
function withSelectedModel(decision, modelId) {
  if (!modelId) return decision;
  const selected = (decision.ordemFallback || []).find((candidate) => candidate.id === modelId);
  if (!selected) return {
    ...decision, escolhido: null, ordemFallback: [],
    motivo: `o modelo selecionado ${modelId} não é compatível com esta chamada (${decision.motivo})`,
  };
  return {
    ...decision, escolhido: selected,
    ordemFallback: [selected, ...(decision.ordemFallback || []).filter((candidate) => candidate.id !== modelId)],
    motivo: `modelo selecionado pelo usuário: ${modelId}; fallback segue a ordem do roteador`,
  };
}

module.exports = { withSelectedModel };
