// Adaptateur SMS : texte libre entrant, réponse courte sortante, branché sur le moteur commun.
//
// Format compatible avec le rappel SMS d'Africa's Talking (`from`, `text`). Une conversation SMS
// est rattachée au numéro de téléphone : la langue choisie reste mémorisée d'un SMS à l'autre, et
// une opération en attente de confirmation peut être confirmée par « 1 » ou « oui » dans le SMS suivant.
// Les menus du moteur deviennent « Répondez 1 : … / 2 : … ».

import { userSession, type Engine, type EngineResult } from '../core/engine.ts';

export const SMS_SEGMENT = 160;

const REPLY_WORD: Record<string, string> = { fr: 'Répondez', en: 'Reply', wes: 'Reply' };

export class SmsChannel {
  private engine: Engine;
  private langs = new Map<string, string>();
  private continuity: boolean;
  constructor(engine: Engine, opts: { continuity?: boolean } = {}) { this.engine = engine; this.continuity = !!opts.continuity; }

  /** Texte du SMS de réponse : réponse du moteur + choix numérotés sur une seule ligne. */
  static format(r: EngineResult): string {
    let t = r.reply.text;
    if (r.reply.menu?.length) {
      const w = REPLY_WORD[r.lang] ?? REPLY_WORD.fr;
      t += `\n${w} ` + r.reply.menu.map((m) => `${m.key} : ${m.label}`).join(' / ');
    }
    return t;
  }

  async handle(p: { from: string; text: string; lang?: string }): Promise<{ reply: string; segments: number; result: EngineResult }> {
    const phone = p.from.replace(/[^\d+]/g, '');
    const lang = p.lang ?? this.langs.get(phone);
    const sid = (this.continuity && userSession(phone)) || `sms:${phone}`;
    const r = await this.engine.handle({ sessionId: sid, channel: 'sms', lang, text: p.text.slice(0, 480), input: 'text' });
    this.langs.set(phone, r.lang);
    const reply = SmsChannel.format(r);
    return { reply, segments: Math.ceil(reply.length / SMS_SEGMENT), result: r };
  }
}
