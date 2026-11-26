// UI Localization Engine (§5.6) : catalogue personnalisable par institution, canal et langue.
// Complète `uiLabels(lang)` avec des clés métier spécifiques à une application bancaire (ex. `transfer.confirmation`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiLabels, type Quality } from '../core/respond.ts';

export const DEFAULT_UI_RESOURCES_FILE = fileURLToPath(new URL('../../data/ui-resources.json', import.meta.url));

export interface UiResourceEntry {
  institution: string; // 'default' ou identifiant institution
  resource: string;    // ex. 'transfer.confirmation'
  language: string;    // ex. 'fr', 'dua', 'ewo'
  channel?: string;    // 'web' | 'mobile' | 'ussd' | '*' (tous)
  value: string;
  quality: Quality;
  updatedAt: string;
}

export class UiCatalog {
  private entries: UiResourceEntry[] = [];
  private file: string | null;

  constructor(file?: string | null) {
    if (file === null) this.file = null;
    else if (typeof file === 'string' && file.trim()) this.file = file.trim();
    else {
      const envFile = process.env.CT_UI_RESOURCES_FILE;
      this.file = envFile ? envFile.trim() : existsSync(DEFAULT_UI_RESOURCES_FILE) ? DEFAULT_UI_RESOURCES_FILE : null;
    }
    this.reload();
  }

  reload(): void {
    if (!this.file || !existsSync(this.file)) { this.entries = []; return; }
    const data = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: UiResourceEntry[] };
    this.entries = Array.isArray(data.entries) ? data.entries : [];
  }

  private save(): void {
    const target = this.file ?? DEFAULT_UI_RESOURCES_FILE;
    this.file = target;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ version: 1, entries: this.entries }, null, 2) + '\n');
  }

  list(filter: { institution?: string; language?: string; channel?: string } = {}): UiResourceEntry[] {
    return this.entries.filter((e) =>
      (!filter.institution || e.institution === filter.institution)
      && (!filter.language || e.language === filter.language)
      && (!filter.channel || !e.channel || e.channel === '*' || e.channel === filter.channel),
    );
  }

  upsert(institution: string, items: { resource: string; language: string; channel?: string; value: string; quality?: Quality }[]): UiResourceEntry[] {
    const inst = institution.trim();
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(inst)) throw new Error('Institution invalide');
    const saved: UiResourceEntry[] = [];
    for (const item of items) {
      const resource = item.resource.trim();
      const language = item.language.trim().toLowerCase();
      const channel = (item.channel ?? '*').trim().toLowerCase() || '*';
      const value = item.value.trim();
      if (!/^[a-zA-Z0-9._-]{2,80}$/.test(resource)) throw new Error(`Ressource invalide : ${resource}`);
      if (!/^[a-z]{2,3}$/.test(language)) throw new Error(`Langue invalide : ${language}`);
      if (!value) throw new Error(`Valeur vide pour ${resource}`);
      const next: UiResourceEntry = {
        institution: inst,
        resource,
        language,
        channel,
        value: value.slice(0, 500),
        quality: item.quality ?? (language === 'fr' || language === 'en' ? 'reference' : 'validated'),
        updatedAt: new Date().toISOString(),
      };
      const idx = this.entries.findIndex((e) => e.institution === inst && e.resource === resource && e.language === language && (e.channel ?? '*') === channel);
      if (idx >= 0) this.entries[idx] = next;
      else this.entries.push(next);
      saved.push(next);
    }
    this.save();
    return saved;
  }

  /** Résout le catalogue final pour une institution, une langue et un canal (base + défaut + institution). */
  resolve(institution: string | undefined, language: string, channel = '*'): Record<string, { value: string; quality: Quality; source: string }> {
    const out: Record<string, { value: string; quality: Quality; source: string }> = {};
    for (const [k, v] of Object.entries(uiLabels(language))) {
      out[k] = { value: v.text, quality: v.quality, source: 'core' };
    }
    const apply = (inst: string, chMatch: (c?: string) => boolean) => {
      for (const e of this.entries) {
        if (e.institution === inst && e.language === language && chMatch(e.channel)) {
          out[e.resource] = { value: e.value, quality: e.quality, source: `catalog:${inst}` };
        }
      }
    };
    apply('default', (c) => !c || c === '*');
    if (channel !== '*') apply('default', (c) => c === channel);
    if (institution && institution !== 'default' && institution !== 'local') {
      apply(institution, (c) => !c || c === '*');
      if (channel !== '*') apply(institution, (c) => c === channel);
    }
    return out;
  }
}

