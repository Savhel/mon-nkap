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
import { userSession, type Engine, type EngineResult } from '../core/engine.ts';

export const USSD_MAX = 182; // longueur maximale d'un écran USSD

const LANGS: [string, string][] = [['fr', 'Français'], ['en', 'English'], ['ewo', 'Ewondo'], ['dua', 'Duala'], ['fub', 'Fulfulde'], ['wes', 'Pidgin'], ['bum', 'Bulu'], ['bas', "Bassa'a"]];

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
  menu_title: { fr: 'Cameroun Translate', en: 'Cameroun Translate' },
  free_text: { fr: 'Ou écrivez votre demande', en: 'Or type your request' },
  next: { fr: 'Suite', en: 'More' },
  choose_lang: { fr: 'Choisissez votre langue', en: 'Choose your language' },
};

type Pack = { phrases: Record<string, Record<string, string>>; ui: Record<string, Record<string, string>> };
const pack: Pack = JSON.parse(readFileSync(new URL('../../data/mboa-pack.json', import.meta.url), 'utf8'));

function label(id: string, lang: string): string {
  const e = pack.phrases[id] ?? pack.ui[id];
  return e?.[lang] ?? FALLBACK_LABELS[id]?.[lang] ?? e?.fr ?? FALLBACK_LABELS[id]?.fr ?? id;
}

interface UssdState { lang?: string; stage: 'lang' | 'main' | 'engine'; pages?: string[]; page?: number; done?: boolean; consumed: number }

export class UssdChannel {
  private states = new Map<string, UssdState>();
  private engine: Engine;
  private continuity: boolean;
  /** continuity : la session du moteur suit le numéro de téléphone (et non la session USSD), pour continuer sur un autre canal. */
  constructor(engine: Engine, opts: { continuity?: boolean } = {}) { this.engine = engine; this.continuity = !!opts.continuity; }

  private langMenu(): string {
    return `${FALLBACK_LABELS.choose_lang.fr} / ${FALLBACK_LABELS.choose_lang.en}\n` + LANGS.map(([, n], i) => `${i + 1}. ${n}`).join('\n');
  }

  private mainMenu(lang: string): string {
    return `${label('menu_title', lang)}\n` + MAIN.map((m) => `${m.key}. ${label(m.label, lang)}`).join('\n') + `\n${label('free_text', lang)}`;
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
  async handle(p: { sessionId: string; phoneNumber: string; text: string }): Promise<{ response: string; result?: EngineResult }> {
    const inputs = p.text === '' ? [] : p.text.split('*');
    const engineSid = (this.continuity && userSession(p.phoneNumber)) || `ussd:${p.sessionId}`;
    let st = this.states.get(p.sessionId);
    if (!st) { st = { stage: 'lang', consumed: 0 }; this.states.set(p.sessionId, st); }
    const fresh = inputs.slice(st.consumed);
    st.consumed = inputs.length;
    const last = fresh.at(-1)?.trim() ?? '';

    if (!fresh.length) return { response: `CON ${this.langMenu()}` };

    // Pagination d'une longue réponse.
    if (last === '98' && st.pages && st.page !== undefined && st.page < st.pages.length - 1) {
      st.page++;
      if (st.done && st.page === st.pages.length - 1) { this.states.delete(p.sessionId); return { response: `END ${st.pages[st.page]}` }; }
      return { response: `CON ${st.pages[st.page]}` };
    }

    if (st.stage === 'lang') {
      const choice = LANGS[Number(last) - 1];
      if (!choice) return { response: `CON ${this.langMenu()}` };
      st.lang = choice[0];
      st.stage = 'main';
      this.engine.session(engineSid, st.lang);
      return { response: `CON ${this.mainMenu(st.lang)}` };
    }

    const lang = st.lang ?? 'fr';
    let utterance = last;
    if (st.stage === 'main') {
      const m = MAIN.find((x) => x.key === last);
      if (m?.key === '7') { st.stage = 'lang'; return { response: `CON ${this.langMenu()}` }; }
      if (m) utterance = m.utterance;
      st.stage = 'engine';
    } else if (last === '0') {
      st.stage = 'main';
      return { response: `CON ${this.mainMenu(lang)}` };
    }

    const r = await this.engine.handle({ sessionId: engineSid, channel: 'ussd', lang, text: utterance, input: 'dtmf' });
    st.lang = r.lang;
    const finished = ['executed', 'cancelled', 'failed'].includes(r.status) || (r.status === 'answered' && !r.reply.menu);
    st.pages = this.paginate(...this.split(r), r.lang);
    st.page = 0;
    st.done = finished;
    if (finished) {
      if (st.pages.length === 1) { this.states.delete(p.sessionId); return { response: `END ${st.pages[0]}`, result: r }; }
      st.stage = 'main';
    }
    return { response: `CON ${st.pages[0]}`, result: r };
  }
}
