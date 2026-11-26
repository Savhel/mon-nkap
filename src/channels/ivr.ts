// Serveur vocal (IVR) : l'utilisateur appelle, choisit sa langue au clavier, puis PARLE sa demande.
// Sa voix passe par la même reconnaissance (Omnilingual ASR) et le même moteur que les autres canaux.
//
// Règle de voix sortante : il n'existe aucune voix de synthèse pour les langues nationales. Le
// serveur vocal ne lit donc JAMAIS un texte ewondo, duala… avec une voix française. Si la langue
// choisie n'a pas de voix, la réponse est lue en français (son équivalent exact), et l'appelant en
// est prévenu dès le choix de la langue. La compréhension, elle, reste dans sa langue.
//
// Ce module est indépendant de l'opérateur : il produit des « invites » (texte + langue de la voix)
// et indique ce qu'il attend ensuite (parole, touches ou fin). `toAfricasTalkingXml` traduit ce
// résultat en XML pour la passerelle vocale d'Africa's Talking.

import type { Engine, EngineResult } from '../core/engine.ts';
import { ttsAvailable } from '../voice/speech.ts';
import { hasNativeVoice, nameKey } from '../voice/native.ts';

export interface Prompt { text: string; voice: string; clips?: string[] } // voice = langue réellement entendue ; clips = enregistrements natifs assemblés
export interface IvrTurn { prompts: Prompt[]; expect: 'digits' | 'speech' | 'end'; lang?: string; nativeVoice?: boolean; result?: EngineResult }

const LANGS: [string, string][] = [['fr', 'français'], ['en', 'English'], ['ewo', 'ewondo'], ['dua', 'duala'], ['fub', 'fulfulde'], ['wes', 'pidgin'], ['bum', 'bulu'], ['bas', "bassa'a"]];

const T = {
  welcome: { fr: 'Bienvenue sur Mon Nkap.', en: 'Welcome to Mon Nkap.' },
  speak: { fr: 'Dites votre demande après le bip, par exemple : envoyer cinq mille francs à Marie. Ou tapez 0 pour réécouter.', en: 'Say your request after the beep, for example: send five thousand francs to Marie. Or press 0 to hear this again.' },
  again: { fr: 'Autre chose ? Parlez après le bip, ou raccrochez.', en: 'Anything else? Speak after the beep, or hang up.' },
  heard_nothing: { fr: 'Je n’ai rien entendu. Parlez plus près du téléphone.', en: 'I did not hear anything. Please speak closer to the phone.' },
  bye: { fr: 'Merci, au revoir.', en: 'Thank you, goodbye.' },
  press: { fr: 'Tapez', en: 'Press' },
};
const t = (k: keyof typeof T, v: string) => (T[k] as Record<string, string>)[v] ?? T[k].fr;

/** Rend un texte prononçable : « 5 000 FCFA » → « 5000 francs CFA », numéro lu par paires. */
export function speakable(text: string, voice: string): string {
  return text
    .replace(/\s*\((\d{9})\)/g, (_, n: string) => `, ${n[0]} ${n.slice(1).match(/\d\d/g)!.join(' ')},`)
    .replace(/(\d)[  ,](?=\d{3}\b)/g, '$1')
    .replace(/\bFCFA\b/g, voice === 'en' ? 'CFA francs' : 'francs CFA')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/ — /g, ', ')
    .replace(/,\s*([.?!])/g, '$1')
    .replace(/\.\s*\./g, '.');
}

interface State { stage: 'lang' | 'talk'; lang: string }

export class IvrChannel {
  private states = new Map<string, State>();
  private engine: Engine;
  constructor(engine: Engine) { this.engine = engine; }

  /** Langue de la voix sortante : celle de l'appelant si une vraie voix existe, sinon le français. */
  static voiceFor(lang: string): string { return ttsAvailable(lang) ? lang : 'fr'; }

  private langMenu(): Prompt[] {
    return [
      { text: `${T.welcome.fr} ${LANGS.map(([code, name], i) => (code === 'en' ? '' : `${name[0].toUpperCase() + name.slice(1)} : tapez ${i + 1}.`)).filter(Boolean).join(' ')}`, voice: 'fr' },
      { text: `${T.welcome.en} For English, press 2.`, voice: 'en' },
    ];
  }

  /** Début d'appel. */
  start(sessionId: string): IvrTurn {
    this.states.set(sessionId, { stage: 'lang', lang: 'fr' });
    return { prompts: this.langMenu(), expect: 'digits' };
  }

  language(sessionId: string): string | undefined { return this.states.get(sessionId)?.lang; }

  end(sessionId: string): void { this.states.delete(sessionId); }

  /** Un tour d'appel : des touches (`digits`) ou une phrase déjà transcrite (`speech`). */
  async step(sessionId: string, input: { digits?: string; speech?: string }): Promise<IvrTurn> {
    const st = this.states.get(sessionId);
    if (!st) return this.start(sessionId);
    const digits = input.digits?.replace(/[^\d*#]/g, '') ?? '';

    if (st.stage === 'lang') {
      const choice = LANGS[Number(digits) - 1];
      if (!choice) return { prompts: this.langMenu(), expect: 'digits' };
      st.lang = choice[0]; st.stage = 'talk';
      this.engine.session(`ivr:${sessionId}`, st.lang);
      return this.intro(st.lang);
    }

    if (digits === '0') return this.intro(st.lang);
    const text = digits || input.speech?.trim() || '';
    if (!text) { const ps = [this.fixed('heard_nothing', st.lang), this.fixed('speak', st.lang)]; return { prompts: ps, expect: 'speech', lang: st.lang, nativeVoice: ps.every((p) => p.voice === st.lang) }; }

    const r = await this.engine.handle({ sessionId: `ivr:${sessionId}`, channel: 'ivr', lang: st.lang, text, input: digits ? 'dtmf' : 'voice' });
    st.lang = r.lang;
    return this.reply(r);
  }

  /** Invite fixe : enregistrement natif si la langue l'a, sinon voix de synthèse fr/en. */
  private fixed(key: 'speak' | 'again' | 'heard_nothing', lang: string): Prompt {
    const clip = `ivr_${key}`;
    if (hasNativeVoice(lang, [clip])) return { text: t(key, 'fr'), voice: lang, clips: [clip] };
    const v = IvrChannel.voiceFor(lang);
    return { text: t(key, v), voice: v };
  }

  private intro(lang: string): IvrTurn {
    if (hasNativeVoice(lang, ['ivr_speak'])) return { prompts: [this.fixed('speak', lang)], expect: 'speech', lang, nativeVoice: true };
    const v = IvrChannel.voiceFor(lang);
    const prompts: Prompt[] = [];
    if (v !== lang) {
      const name = LANGS.find(([c]) => c === lang)?.[1] ?? lang;
      prompts.push({ text: `Vous avez choisi ${name}. Les réponses audio non couvertes par un enregistrement seront lues en français.`, voice: 'fr' });
    }
    prompts.push({ text: t('speak', v), voice: v });
    return { prompts, expect: 'speech', lang, nativeVoice: v === lang };
  }

  private reply(r: EngineResult): IvrTurn {
    // 1) Enregistrements natifs : si TOUS les morceaux de la réponse (et du menu) existent, on les joue.
    if (r.reply.lang === r.lang && hasNativeVoice(r.lang, r.reply.speech)) {
      const prompts: Prompt[] = [{ text: r.reply.text, voice: r.lang, clips: r.reply.speech }];
      let expect: IvrTurn['expect'] = 'speech';
      let menuOk = true;
      if (r.reply.menu?.length) {
        const clips = r.status === 'awaiting_confirmation' ? ['press_1_confirm', 'press_2_cancel'] : r.reply.menu.flatMap((m) => [`press_${m.key}`, nameKey(m.label.replace(/\s*\(\d+\)$/, ''))]);
        menuOk = hasNativeVoice(r.lang, clips);
        if (menuOk) prompts.push({ text: r.reply.menu.map((m) => `${m.key}. ${m.label}`).join(' '), voice: r.lang, clips });
        expect = 'digits';
      } else if (['executed', 'cancelled', 'failed', 'answered'].includes(r.status)) {
        const again = this.fixed('again', r.lang);
        if (again.voice === r.lang) prompts.push(again); else menuOk = false;
      }
      if (menuOk) return { prompts, expect, lang: r.lang, nativeVoice: true, result: r };
    }
    // 2) Sinon : voix de synthèse fr/en, avec l'équivalent français pour une langue sans voix.
    const v = IvrChannel.voiceFor(r.lang);
    // Texte lu : la réponse elle-même si sa langue a une voix, sinon son équivalent français exact.
    const native = r.reply.lang === v;
    const body = native ? r.reply.text : r.reply.fr;
    const prompts: Prompt[] = [{ text: speakable(body, v), voice: v }];
    let expect: IvrTurn['expect'] = 'speech';
    if (r.reply.menu?.length) {
      const confirm = r.status === 'awaiting_confirmation';
      const labels = confirm ? (v === 'en' ? ['confirm', 'cancel'] : ['confirmer', 'annuler']) : r.reply.menu.map((m) => m.label.replace(/\s*\(\d+\)$/, ''));
      prompts.push({ text: r.reply.menu.map((m, i) => `${t('press', v)} ${m.key} ${v === 'en' ? 'to' : 'pour'} ${labels[i]}.`).join(' '), voice: v });
      expect = 'digits';
    } else if (['executed', 'cancelled', 'failed'].includes(r.status) || r.status === 'answered') {
      prompts.push({ text: t('again', v), voice: v });
    }
    return { prompts, expect, lang: r.lang, nativeVoice: v === r.lang, result: r };
  }
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Traduit un tour en XML pour la passerelle vocale Africa's Talking. Les invites sont jouées depuis
 *  notre propre synthèse (Piper, `/v1/tts`) : la passerelle ne lit jamais elle-même un texte. */
export function toAfricasTalkingXml(turn: IvrTurn, publicUrl: string, callbackUrl: string): string {
  const plays = turn.prompts.map((p) => `<Play url="${xmlEsc(publicUrl + (p.clips ? `/v1/native?lang=${p.voice}&clips=${p.clips.join(',')}` : `/v1/tts?lang=${p.voice}&text=${encodeURIComponent(p.text)}`))}"/>`).join('');
  const cb = xmlEsc(callbackUrl);
  if (turn.expect === 'end') return `<?xml version="1.0" encoding="UTF-8"?><Response>${plays}</Response>`;
  if (turn.expect === 'digits') return `<?xml version="1.0" encoding="UTF-8"?><Response><GetDigits timeout="10" numDigits="1" callbackUrl="${cb}">${plays}</GetDigits></Response>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Record finishOnKey="#" maxLength="12" trimSilence="true" playBeep="true" callbackUrl="${cb}">${plays}</Record></Response>`;
}
