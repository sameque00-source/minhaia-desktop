const chat = require('./store');
const store = require('../missions/store');
const views = require('../missions/views');

// A resposta-resumo do assistente é gravada quando a missão emite `finished`. Se o processo dono
// cair antes disso (reinício do servidor/app), a conversa fica com um pedido sem resposta.
// `reconcile` fecha essa lacuna na leitura: qualquer pedido cujo job já terminou e ainda não tem
// resposta ganha o resumo agora. É idempotente (não duplica), não altera a missão e nunca derruba
// a leitura por causa de um registro corrompido.

const FINAL = new Set(['CONCLUIDA', 'FALHA', 'BLOQUEADA', 'CANCELADA', 'TEMPO_ESGOTADO', 'INTERROMPIDA']);

/** Resumo real (status + arquivos + motivo) de uma missão terminada, para o chat do projeto. */
function resumoDaMissao(job) {
  const d = views.detail(job.id);
  const mission = d && d.mission;
  const arquivos = [...new Set(((mission && mission.subtarefas) || []).flatMap((t) => (t.resultado && t.resultado.arquivos) || []))];
  const partes = [];
  if (job.status === 'CONCLUIDA') {
    partes.push(`Concluída${arquivos.length ? ` — arquivos: ${arquivos.slice(0, 10).join(', ')}${arquivos.length > 10 ? ` (+${arquivos.length - 10})` : ''}` : ''}.`);
  } else if (job.status === 'BLOQUEADA') {
    partes.push(`Bloqueada: ${job.reason || (d && d.blocked) || 'motivo não informado'}.`);
  } else if (job.status === 'FALHA') {
    partes.push(`Falhou: ${job.reason || 'motivo não informado'}.`);
  } else {
    partes.push(`${job.status}${job.reason ? `: ${job.reason}` : ''}.`);
  }
  const fim = mission && mission.estadoFinal;
  if (fim && fim.motivo) partes.push(String(fim.motivo));
  const usados = [...new Set(store.readEvents(job.id, { types: ['llm.end'] }).filter((event) => event.ok && event.model).map((event) => event.model))];
  if (job.modelId) {
    const fallback = usados.filter((model) => model !== job.modelId);
    partes.push(fallback.length
      ? `Modelo solicitado: ${job.modelId}. O roteador usou como fallback: ${fallback.join(', ')}.`
      : usados.includes(job.modelId) ? `Modelo utilizado: ${job.modelId}.`
        : `Modelo solicitado: ${job.modelId}; não há chamada bem-sucedida registrada para este modelo.`);
  } else if (usados.length) {
    partes.push(`Modelo(s) utilizado(s): ${usados.join(', ')}.`);
  }
  return partes.join(' ').trim();
}

/** Responde no chat os pedidos terminados que ficaram sem resposta; devolve quantas respostas criou. */
function reconcile(projectId, sessionId = null) {
  const msgs = chat.list(projectId, { sessionId });
  const respondidas = new Set(msgs.filter((m) => m.role === 'assistant' && m.missionId).map((m) => m.missionId));
  let added = 0;
  for (const m of msgs) {
    if (m.role !== 'user' || !m.missionId || respondidas.has(m.missionId)) continue;
    try {
      const job = store.get(m.missionId);
      if (!job || !FINAL.has(job.status)) continue;
      const text = resumoDaMissao(job);
      if (!text) continue;
      chat.append(projectId, { role: 'assistant', text, missionId: m.missionId, sessionId });
      respondidas.add(m.missionId);
      added++;
    } catch (e) {
      process.stderr.write(`[minhaia chat] reconciliação de ${m.missionId}: ${e.message}\n`);
    }
  }
  return added;
}

module.exports = { reconcile, resumoDaMissao };
