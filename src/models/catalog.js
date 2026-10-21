'use strict';

const fs = require('fs');
const path = require('path');
const { paths, secretNames } = require('../config');

const PROVIDER_KEY = {
  Groq: 'GROQ_API_KEY',
  'Google AI Studio': 'GOOGLE_API_KEY',
  OpenRouter: 'OPENROUTER_API_KEY',
  '9Router': 'NINEROUTER_API_KEY',
};

function readCatalog() {
  const file = path.join(paths.AIORCH_DIR, 'catalog', 'models.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).models || [];
}

function list() {
  const names = secretNames();
  const providers = require(path.join(paths.AIORCH_DIR, 'gateway', 'providers.js')).ADAPTERS;
  return readCatalog().filter((m) => m.free === true && m.requires_card !== true && (m.modality || []).includes('text'))
    .map((m) => {
      const key = PROVIDER_KEY[m.provider];
      const supported = !!providers[m.provider] && !!key;
      return {
        id: m.id, provider: m.provider, model: m.model, modality: m.modality || [],
        contextWindow: m.context_window || null, tools: !!m.tools, agentCapable: !!m.agent_capable,
        levels: m.level_tags || [], health: m.health || 'unknown',
        available: supported && names.has(key),
        unavailableReason: !supported ? 'Este provedor não possui adaptador de execução compatível.'
          : !names.has(key) ? `Configure ${key} em .secrets/.env para usar este modelo.` : null,
        reasoningEffort: false,
      };
    });
}

function requireAvailable(id) {
  if (typeof id !== 'string' || id.length > 160) throw Object.assign(new Error('modelo inválido'), { status: 400 });
  const model = list().find((m) => m.id === id);
  if (!model) throw Object.assign(new Error('modelo não encontrado no catálogo elegível'), { status: 400 });
  if (!model.available) throw Object.assign(new Error(model.unavailableReason || 'modelo indisponível'), { status: 422 });
  return model;
}

module.exports = { list, requireAvailable };
