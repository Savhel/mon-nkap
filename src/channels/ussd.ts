// Adaptateur USSD (*126#) : menus numérotés et saisie libre, branchés sur le moteur commun.
//
// Protocole compatible Africa's Talking (le plus répandu en Afrique) : à chaque échange, la passerelle
// envoie `sessionId`, `phoneNumber`, `serviceCode` et `text` = toutes les saisies jointes par « * »
// (ex. « 3*2*5000 »). On répond « CON … » (la session continue) ou « END … » (elle se termine).
//
// L'adaptateur ne comprend rien lui-même : un choix de menu devient une phrase canonique
// (« solde », « envoyer »…) envoyée au moteur, exactement comme si l'utilisateur l'avait écrite.
// C'est ce qui garantit la même interprétation sur tous les canaux.

import { readFileSync } from 'node:fs';
import { loadPack, usable } from '../linguistics/pack.ts';
import { userSession, type Engine, type EngineResult } from '../core/engine.ts';

export const USSD_IDLE_MS = 2 * 60_000;
export const USSD_MAX = 182; // longueur maximale d'un écran USSD

const LANGS: [string, string][] = [['fr', 'Français'], ['en', 'English'], ['ewo', 'Ewondo'], ['dua', 'Duala'], ['fub', 'Fulfulde'], ['wes', 'Pidgin'], ['bum', 'Bulu (menu FR)'], ['bas', 'Basaa (menu FR)']];

// Choix du menu principal → phrase canonique envoyée au moteur (en français : le moteur écoute
// toujours le français en plus de la langue choisie).
const MAIN: { key: string; label: string; utterance: string }[] = [
  { key: '1', label: 'step_balance', utterance: 'solde' },
  { key: '2', label: 'transfer_title', utterance: 'envoyer de l’argent' },
  { key: '3', label: 'step_fees', utterance: 'frais' },
  { key: '4', label: 'history', utterance: 'historique' },
  { key: '5', label: 'airtime', utterance: 'acheter du crédit' },
  { key: '6', label: 'bill', utterance: 'payer une facture' },
  { key: '7', label: 'language', utterance: '' },
];

const FALLBACK_LABELS: Record<string, Record<string, string>> = {
  airtime: { fr: 'Crédit', en: 'Airtime' },
  bill: { fr: 'Facture', en: 'Pay a bill' },
  step_balance: { en: 'Balance' }, transfer_title: { en: 'Send money' }, step_fees: { en: 'Fees' }, history: { en: 'History' }, language: { en: 'Language' },
  menu_title: { fr: 'Mon Nkap', en: 'Mon Nkap' },
  free_text: { fr: 'Ou écrivez votre demande', en: 'Or type your request' },
  next: { fr: 'Suite', en: 'More' },
  choose_lang: { fr: 'Choisissez votre langue', en: 'Choose your language' },
};

type Pack = { phrases: Record<string, Record<string, string>>; ui: Record<string, Record<string, string>> };
const pack: Pack = JSON.parse(readFileSync(new URL('../../data/mboa-pack.json', import.meta.url), 'utf8'));

const MENUS: Record<string, string> = {
  step_balance: 'menu_balance', transfer_title: 'menu_transfer', step_fees: 'menu_fees', history: 'menu_history',
  airtime: 'menu_airtime', bill: 'menu_bill', language: 'menu_language', free_text: 'menu_free_text', next: 'menu_more',
};

function localizedMenu(id: string, lang: string): string | undefined {
  const entry = loadPack(lang)?.responses[MENUS[id]];
  if (!entry || !usable(entry)) return;
  const text = entry.text.trim();
  const limit = id === 'free_text' ? 29 : id === 'next' ? 22 : 17;
  return text.length > 0 && text.length <= limit && !/[\r\n]/.test(text) ? text : undefined;
}

function label(id: string, lang: string): string {
  const e = pack.phrases[id] ?? pack.ui[id];
  return localizedMenu(id, lang) ?? e?.[lang] ?? FALLBACK_LABELS[id]?.[lang] ?? e?.fr ?? FALLBACK_LABELS[id]?.fr ?? id;
}

interface UssdState { lang?: string; stage: 'lang' | 'main' | 'engine'; pages?: string[]; page?: number; done?: boolean; input: string; expires: number; screen: string; token?: string }

export class UssdChannel {
  private states = new Map<string, UssdState>();
  private engine: Engine;
  private continuity: boolean;
  /** continuity : la session du moteur suit le numéro de téléphone (et non la session USSD), pour continuer sur un autre canal. */
  constructor(engine: Engine, opts: { continuity?: boolean } = {}) { this.engine = engine; this.continuity = !!opts.continuity; }

  private langMenu(): string {
    const choices = LANGS.map(([code, name], i) => {
      const localized = MAIN.filter(({ label }) => localizedMenu(label, code)).length;
      if (!name.endsWith(' (menu FR)') || !localized) return `${i + 1}. ${name}`;
      return `${i + 1}. ${name.replace(' (menu FR)', localized === MAIN.length ? '' : ' (mixte)')}`;
    });
    return `${FALLBACK_LABELS.choose_lang.fr} / ${FALLBACK_LABELS.choose_lang.en}\n${choices.join('\n')}`;
  }

  private mainMenu(lang: string): string {
    const menu = `${label('menu_title', lang)}\n` + MAIN.map((m) => `${m.key}. ${label(m.label, lang)}`).join('\n');
    const guide = `\n${label('free_text', lang)}`;
    return menu.length + guide.length <= USSD_MAX ? menu + guide : menu;
  }

  /** Coupe une ligne trop longue aux espaces ordinaires. Les montants utilisent une espace fine
   *  insécable (« 5 000 ») : ils ne sont donc jamais coupés. */
  private wrap(line: string, max: number): string[] {
    if (line.length <= max) return [line];
    const out: string[] = []; let cur = '';
    for (const w of line.split(' ')) {
      const c = cur ? `${cur} ${w}` : w;
      if (c.length > max && cur) { out.push(cur); cur = w; } else cur = c;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Découpe en écrans de 182 caractères au plus. Le texte est coupé entre les lignes ; les choix
   *  numérotés forment un bloc qui reste entier sur le dernier écran, pour que « 1 » et « 2 » soient
   *  visibles ensemble. */
  private paginate(body: string, menu: string, lang: string): string[] {
    const more = `\n98. ${label('next', lang)}`;
    const room = USSD_MAX - more.length;
    const lines = body.split('\n').flatMap((l) => this.wrap(l, room));
    const pages: string[] = [];
    let cur = '';
    for (const line of lines) {
      const candidate = cur ? `${cur}\n${line}` : line;
      if (candidate.length > room && cur) { pages.push(cur); cur = line; } else cur = candidate;
    }
    if (menu) {
      const withMenu = cur ? `${cur}\n${menu}` : menu;
      if (withMenu.length <= USSD_MAX || !cur) cur = withMenu;
      else { pages.push(cur); cur = menu; }
    }
    if (cur) pages.push(cur);
    return pages.map((p, i) => (i < pages.length - 1 ? p + more : p));
  }

  private split(r: EngineResult): [string, string] {
    // Les listes « a ; b ; c » (historique) s'affichent une opération par ligne.
    const body = r.reply.text.replace(/ ; /g, '\n').replace(/^([^\n:]{4,60}) : (?=\S)/, '$1 :\n');
    const menu = r.reply.menu ? r.reply.menu.map((m) => `${m.key}. ${m.label}`).join('\n') : '';
    return [body, menu];
  }

  /** Traite une requête de la passerelle et renvoie la réponse « CON … » ou « END … ». */
  async handle(p: { sessionId: string; phoneNumber: string; text: string; trial?: string }): Promise<{ response: string; result?: EngineResult }> {
    const inputs = p.text === '' ? [] : p.text.split('*');
    const key = JSON.stringify([p.phoneNumber, p.sessionId]);
    const engineSid = (this.continuity && userSession(p.phoneNumber)) || `ussd:${key}`;
    const now = Date.now();
    // Éliminer les anciens écrans dont la passerelle ne rappelle plus la session.
    for (const [id, state] of this.states) if (state.expires + USSD_IDLE_MS <= now) this.states.delete(id);
    let st = this.states.get(key);
    if (p.text === '' && (!st || st.input !== '' || st.expires <= now)) {
      st = { stage: 'lang', input: '', expires: now + USSD_IDLE_MS, screen: `CON ${this.langMenu()}` };
      this.states.set(key, st);
    }
    if (!st || st.expires <= now) return { response: 'END Session expirée. Relancez le code USSD.' };
    if (p.text === st.input) return { response: st.screen };
    if (st.screen.startsWith('END ') || inputs.length !== (st.input ? st.input.split('*').length : 0) + 1 ||
        (st.input && !p.text.startsWith(st.input + '*'))) return { response: st.screen };
    st.input = p.text;
    st.expires = now + USSD_IDLE_MS;
    const last = inputs.at(-1)?.trim() ?? '';
    const screen = (response: string, result?: EngineResult) => {
      st.screen = response;
      return { response, result };
    };

    if (st.pages && st.page !== undefined && st.page < st.pages.length - 1) {
      if (last === '98') {
        st.page++;
        return screen(`${st.done && st.page === st.pages.length - 1 ? 'END' : 'CON'} ${st.pages[st.page]}`);
      }
      if (last !== '0') return { response: st.screen };
    }

    if (st.stage === 'lang') {
      const choice = LANGS[Number(last) - 1];
      if (!choice) return screen(`CON ${this.langMenu()}`);
      st.lang = choice[0];
      st.stage = 'main';
      this.engine.session(engineSid, st.lang);
      return screen(`CON ${this.mainMenu(st.lang)}`);
    }

    const lang = st.lang ?? 'fr';
    let utterance = last;
    if (st.stage === 'main') {
      const m = MAIN.find((x) => x.key === last);
      if (m?.key === '7') { st.stage = 'lang'; return screen(`CON ${this.langMenu()}`); }
      if (m) utterance = m.utterance;
      st.stage = 'engine';
    } else if (last === '0') {
      await this.engine.handle({ sessionId: engineSid, channel: 'ussd', lang, text: 'annuler', input: 'dtmf', trial: p.trial });
      st.stage = 'main'; st.pages = undefined; st.token = undefined;
      return screen(`CON ${this.mainMenu(lang)}`);
    }

    const r = last === '1' && st.token
      ? await this.engine.confirmWithToken(engineSid, st.token, 'ussd', undefined, p.trial)
      : await this.engine.handle({ sessionId: engineSid, channel: 'ussd', lang, text: utterance, input: 'dtmf', trial: p.trial });
    if ('error' in r) return screen('END Récapitulatif expiré ou modifié. Reprenez la demande.');
    st.token = r.canonical.confirmationToken;
    st.lang = r.lang;
    const finished = ['executed', 'cancelled', 'failed'].includes(r.status) || (r.status === 'answered' && !r.reply.menu);
    st.pages = this.paginate(...this.split(r), r.lang);
    st.page = 0;
    st.done = finished;
    if (finished) {
      if (st.pages.length === 1) return screen(`END ${st.pages[0]}`, r);
      st.stage = 'main';
    }
    return screen(`CON ${st.pages[0]}`, r);
  }
}
