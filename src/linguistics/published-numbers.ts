import { normalize, tokens } from '../core/text.ts';

interface PublishedNumberRules {
  source: string;
  forms: Record<string, number>;
  additive: string[];
}

// Formes cardinales documentées. Les formes orthographiques sans tons passent par normalize().
export const PUBLISHED_NUMBERS: Readonly<Record<string, PublishedNumberRules>> = {
  ewo: {
    source: 'https://lingweb.eva.mpg.de/channumerals/Ewondo.htm',
    forms: { awom: 10, 'məwom bɛ': 20, ntɛd: 100, 'mintɛd mibɛ': 200,
      akuda: 1000, 'bakuda bəbɛ': 2000, 'tɔɡsin': 1000, 'tɔɡsin i bɛ': 2000 },
    additive: [],
  },
  dua: {
    source: 'https://peuplesawa.com/fr/bnnews.php?nid=116&profil=0&seite=4&sites=0&vip=0',
    forms: { dom: 10, mwaba: 20, mwalalo: 30, ebwea: 100, 'bebwea beba': 200, 'bebwea belalo': 300,
      'bebwea benei': 400, 'bebwea betanu': 500, ikoli: 1000, 'lokoli loba': 2000,
      'lokoli lolalo': 3000, 'lokoli lonei': 4000, 'lokoli lotanu': 5000, 'dom la lokoli': 10000,
      'mwaba mwa lokoli': 20000, 'mwalalo mwa lokoli': 30000, 'ebwea lokoli': 100000 },
    additive: ['na'],
  },
  bas: {
    source: 'https://s3-eu-west-1.amazonaws.com/s3-eu-west-1-ap-pe-ws4-cws-documents.ri-prod/9781138799677/Bantu_Languages_Part_2.pdf',
    forms: { jom: 10, 'jom ni boo': 19, 'mom maa': 20, moomaa: 20, mbogol: 100, hikoo: 1000 },
    additive: [],
  },
  bum: {
    source: 'https://lingweb.eva.mpg.de/channumerals/Bulu-Bantu.htm',
    forms: { awoom: 10, 'awom a bebae': 12, 'mewom bae': 20, ntet: 100, 'mintet mibae': 200,
      tojini: 1000, 'tojini ebae': 2000 },
    additive: [],
  },
};

const compiled = new Map(Object.entries(PUBLISHED_NUMBERS).map(([lang, rules]) => [lang,
  Object.entries(rules.forms).map(([form, value]) => ({ words: tokens(form.replace(/ɡ/g, 'g')), value }))
    .sort((a, b) => b.words.length - a.words.length),
]));

export function publishedNumeralize(text: string, lang: string): string {
  const forms = compiled.get(lang);
  if (!forms) return text;
  const matches = [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)];
  const words = matches.map((match) => normalize(match[0].replace(/ɡ/g, 'g')));
  const joined = (i: number) => i > 0 && i < words.length &&
    /^[\s'’]+$/.test(text.slice(matches[i - 1].index! + matches[i - 1][0].length, matches[i].index!));
  const at = (i: number) => forms.find(({ words: pattern }) =>
    pattern.every((word, j) => words[i + j] === word && (j === 0 || joined(i + j))));
  const links = PUBLISHED_NUMBERS[lang].additive;
  let from = 0;
  let result = '';
  for (let i = 0; i < words.length;) {
    const entry = at(i);
    if (!entry) { i++; continue; }
    let end = i + entry.words.length;
    let amount = entry.value;
    let last = entry.value;
    while (links.includes(words[end]) && joined(end) && joined(end + 1)) {
      const next = at(end + 1);
      if (!next || next.value >= last) break;
      amount += next.value;
      last = next.value;
      end += 1 + next.words.length;
    }
    const next = words[end];
    const unfinishedUnit = /^(bebwea|lokoli|dikoo)$/.test(next ?? '') ||
      (lang === 'ewo' && words[i] === 'togsin' && end === i + 1 && next === 'i');
    if (unfinishedUnit && joined(end)) {
      // Une forme de grande unité non comprise ne doit pas réduire un montant composé à son préfixe.
      i = end + 1;
      continue;
    }
    result += text.slice(from, matches[i].index!) + String(amount);
    from = matches[end - 1].index! + matches[end - 1][0].length;
    i = end;
  }
  return result + text.slice(from);
}
