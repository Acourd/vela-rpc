/**
 * Acourd RPC — Dynamic Presence Template & Preset Engine
 * Zero-dependency customizable formatting, localization (ES/EN),
 * curated product presets, and persistent user config (~/.acourd/config.json).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { COGNITIVE_STATES } from './constants.js';

export const LOCALIZED_STATES = Object.freeze({
  en: {
    [COGNITIVE_STATES.IDLE]: { label: 'Standing by', description: 'Ready for next mission', emoji: '✦' },
    [COGNITIVE_STATES.THINKING]: { label: 'Architecting & Reasoning', description: 'Deep synthesis', emoji: '🧠' },
    [COGNITIVE_STATES.TOOL_CALL]: { label: 'Building & Executing', description: 'Modifying codebase', emoji: '⚡' },
    [COGNITIVE_STATES.SWARM]: { label: 'Orchestrating Swarm', description: 'Multi-agent topology', emoji: '🚀' },
    [COGNITIVE_STATES.VERIFYING]: { label: 'Verifying Quality', description: 'Deterministic checks', emoji: '🛡️' },
    [COGNITIVE_STATES.REVIEWING]: { label: 'Auditing Code', description: 'Architecture review', emoji: '🔍' },
  },
  es: {
    [COGNITIVE_STATES.IDLE]: { label: 'En espera', description: 'Listo para la siguiente misión', emoji: '✦' },
    [COGNITIVE_STATES.THINKING]: { label: 'Pensando arquitectura', description: 'Síntesis profunda', emoji: '🧠' },
    [COGNITIVE_STATES.TOOL_CALL]: { label: 'Construyendo código', description: 'Ejecutando herramientas', emoji: '⚡' },
    [COGNITIVE_STATES.SWARM]: { label: 'Enjambre activo', description: 'Múltiples agentes en paralelo', emoji: '🚀' },
    [COGNITIVE_STATES.VERIFYING]: { label: 'Verificando pruebas', description: 'Validación determinista', emoji: '🛡️' },
    [COGNITIVE_STATES.REVIEWING]: { label: 'Auditando código', description: 'Revisión de arquitectura', emoji: '🔍' },
  },
});

export const PRESETS = Object.freeze({
  autonomous: {
    id: 'autonomous',
    name: 'Autonomous Minimal',
    description: 'Ultra-minimalista: título real del chat arriba y solo el modelo abajo. Cero ruido.',
    detailsTemplate: '{chat_or_task}',
    stateTemplate: '{model}',
    showEmojis: false,
    showElapsed: true,
  },
  telemetry: {
    id: 'telemetry',
    name: 'Telemetry Pro (B)',
    description: 'Modelo + proyecto/rama arriba, estado y pasos/tokens abajo. Cero emojis.',
    detailsTemplate: '{model} · {project}',
    stateTemplate: '{status} · {branch}',
    showEmojis: false,
    showElapsed: true,
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Minimalista, limpio y ejecutivo. Sin ruido visual.',
    detailsTemplate: '{emoji} {task_or_state}',
    stateTemplate: '{project} · {branch}',
    showEmojis: true,
    showElapsed: true,
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    description: 'Expresivo y dinámico, muestra misión activa, proyecto y rama.',
    detailsTemplate: '{emoji} {task_or_state}',
    stateTemplate: '{project} • {branch}',
    showEmojis: true,
    showElapsed: true,
  },
  stealth: {
    id: 'stealth',
    name: 'Stealth',
    description: 'Modo privacidad total. Oculta nombres de proyectos y ramas.',
    detailsTemplate: '{emoji} {state}',
    stateTemplate: 'Deep Focus • {agent}',
    showEmojis: true,
    showElapsed: true,
    stealthMode: true,
  },
  hacker: {
    id: 'hacker',
    name: 'Hacker',
    description: 'Estética técnica de terminal con delimitadores limpios.',
    detailsTemplate: '> {task_or_state}',
    stateTemplate: '[{project}:{branch}] // {agent}',
    showEmojis: false,
    showElapsed: true,
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    description: 'Plantillas 100% personalizadas por el usuario.',
    detailsTemplate: '{emoji} {task_or_state}',
    stateTemplate: '{project} · {branch}',
    showEmojis: true,
    showElapsed: true,
  },
});

export const DEFAULT_CONFIG = Object.freeze({
  preset: 'studio',
  lang: 'es',
  showEmojis: true,
  showElapsed: true,
  stealthMode: false,
  detailsTemplate: null, // null = use active preset's template
  stateTemplate: null,   // null = use active preset's template
  customButtons: [],     // up to 2 [{ label, url }]
  clientIds: {},         // optional custom Discord Application IDs per harness (e.g. { antigravity, claude })
  iconStyle: 'classic',  // 'classic' | 'titanium' | 'light'
});

/**
 * Cleanly interpolates `{variable}` tokens and strips orphan delimiters
 * (e.g. "acourd-rpc · " -> "acourd-rpc", "  🧠  " -> "🧠").
 */
export function renderTemplate(template, vars = {}) {
  if (typeof template !== 'string' || !template.trim()) return '';

  let rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val).trim() : '';
  });

  // Collapse duplicate whitespace
  rendered = rendered.replace(/\s+/g, ' ').trim();

  // Remove empty brackets like "[:]" or "[]"
  rendered = rendered.replace(/\[\s*:?\s*\]/g, '').trim();

  // Clean orphan separators at start/end or doubled separators (·, •, |, //, ::)
  rendered = rendered
    .replace(/^(?:[·•|:]|\/\/)\s*/g, '')
    .replace(/\s*(?:[·•|:]|\/\/)$/g, '')
    .replace(/([·•|])\s*\1+/g, '$1')
    .replace(/:\s*\]/g, ']')
    .replace(/\[\s*:/g, '[')
    .replace(/\s+/g, ' ')
    .trim();

  return rendered;
}

/**
 * Resolves the effective templates and flags for a given config object.
 */
export function resolveEffectiveConfig(userConfig = {}) {
  const merged = { ...DEFAULT_CONFIG, ...userConfig };
  const presetObj = PRESETS[merged.preset] || PRESETS.studio;
  const lang = merged.lang === 'en' ? 'en' : 'es';

  return {
    preset: presetObj.id,
    lang,
    showEmojis: merged.showEmojis !== undefined ? Boolean(merged.showEmojis) : presetObj.showEmojis,
    showElapsed: merged.showElapsed !== undefined ? Boolean(merged.showElapsed) : presetObj.showElapsed,
    stealthMode: merged.stealthMode || Boolean(presetObj.stealthMode),
    detailsTemplate: merged.detailsTemplate || presetObj.detailsTemplate,
    stateTemplate: merged.stateTemplate || presetObj.stateTemplate,
    customButtons: Array.isArray(merged.customButtons) ? merged.customButtons : [],
    clientIds: (merged.clientIds && typeof merged.clientIds === 'object') ? merged.clientIds : {},
    iconStyle: ['classic', 'titanium', 'light'].includes(merged.iconStyle) ? merged.iconStyle : 'classic',
  };
}

/**
 * Persistent configuration manager for ~/.acourd/config.json.
 */
export class ConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath !== undefined
      ? options.configPath
      : ConfigManager.getDefaultConfigPath();
    this.config = { ...DEFAULT_CONFIG };
    if (this.configPath) {
      this.load();
    }
  }

  static getDefaultConfigPath() {
    const dir = path.join(os.homedir(), '.acourd');
    return path.join(dir, 'config.json');
  }

  load() {
    if (!this.configPath) return this.config;
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.config = { ...DEFAULT_CONFIG, ...parsed };
        }
      }
    } catch (_) {
      // Fall back safely to defaults on malformed JSON
      this.config = { ...DEFAULT_CONFIG };
    }
    return this.config;
  }

  save() {
    if (!this.configPath) return false;
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  update(patch = {}) {
    if (!patch || typeof patch !== 'object') return this.getEffective();

    if (patch.reset) {
      this.config = { ...DEFAULT_CONFIG };
      this.save();
      return this.getEffective();
    }

    // If switching to a built-in preset (not custom), clear custom overrides unless explicitly passed
    if (patch.preset && PRESETS[patch.preset] && patch.preset !== 'custom') {
      this.config.preset = patch.preset;
      this.config.detailsTemplate = patch.detailsTemplate ?? null;
      this.config.stateTemplate = patch.stateTemplate ?? null;
      this.config.showEmojis = patch.showEmojis ?? PRESETS[patch.preset].showEmojis;
      this.config.stealthMode = patch.stealthMode ?? Boolean(PRESETS[patch.preset].stealthMode);
    } else {
      if (patch.preset && PRESETS[patch.preset]) this.config.preset = patch.preset;
      if (patch.detailsTemplate !== undefined) {
        this.config.detailsTemplate = patch.detailsTemplate;
        if (patch.detailsTemplate && !patch.preset) this.config.preset = 'custom';
      }
      if (patch.stateTemplate !== undefined) {
        this.config.stateTemplate = patch.stateTemplate;
        if (patch.stateTemplate && !patch.preset) this.config.preset = 'custom';
      }
      if (patch.showEmojis !== undefined) this.config.showEmojis = Boolean(patch.showEmojis);
      if (patch.stealthMode !== undefined) this.config.stealthMode = Boolean(patch.stealthMode);
    }

    if (patch.lang === 'es' || patch.lang === 'en') this.config.lang = patch.lang;
    if (patch.showElapsed !== undefined) this.config.showElapsed = Boolean(patch.showElapsed);
    if (Array.isArray(patch.customButtons)) this.config.customButtons = patch.customButtons;
    if (patch.clientIds && typeof patch.clientIds === 'object') {
      this.config.clientIds = { ...(this.config.clientIds || {}), ...patch.clientIds };
    }
    if (['classic', 'titanium', 'light'].includes(patch.iconStyle)) {
      this.config.iconStyle = patch.iconStyle;
    }

    this.save();
    return this.getEffective();
  }

  getEffective() {
    return resolveEffectiveConfig(this.config);
  }
}
