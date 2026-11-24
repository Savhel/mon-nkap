// Normalisation et comparaison approximative de texte.
// La sortie d'un ASR contient des fautes ("sod de mon comte" pour "solde de mon compte") :
// toute la compréhension se fait donc sur du texte normalisé, avec une tolérance d'édition.

/** Minuscules, sans diacritiques ni tons, apostrophes unifiées, ponctuation retirée. */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’`ʼ]/g, "'")
    .replace(/ɔ/g, 'o')
    .replace(/ɛ/g, 'e')
    .replace(/ə/g, 'e')
    .replace(/ŋ/g, 'ng')
    .replace(/ɓ/g, 'b')
    .replace(/ɗ/g, 'd')
    .replace(/ƴ/g, 'y')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(input: string): string[] {
  const n = normalize(input).replace(/'/g, ' ');
  return n ? n.split(' ') : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Tolérance d'édition selon la longueur du mot : 0 (≤3), 1 (4-6), 2 (≥7). */
export function tolerance(word: string): number {
  return word.length <= 3 ? 0 : word.length <= 6 ? 1 : 2;
}

export function wordMatches(candidate: string, keyword: string): boolean {
  return levenshtein(candidate, keyword) <= tolerance(keyword);
}

/**
 * Cherche une expression (un ou plusieurs mots) dans une liste de jetons, avec tolérance.
 * Renvoie l'indice du premier jeton trouvé, ou -1.
 */
export function findPhrase(toks: string[], phrase: string): number {
  const p = tokens(phrase);
  if (!p.length) return -1;
  outer: for (let i = 0; i + p.length <= toks.length; i++) {
    for (let k = 0; k < p.length; k++) if (!wordMatches(toks[i + k], p[k])) continue outer;
    return i;
  }
  // Mots collés par l'ASR ("deving" pour "de vingt") : on compare aussi la version sans espaces.
  if (p.length > 1) {
    const glued = p.join('');
    for (let i = 0; i < toks.length; i++) if (wordMatches(toks[i], glued)) return i;
  }
  return -1;
}
