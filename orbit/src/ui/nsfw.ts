/**
 * Whether a picture or video is NSFW, judged by the words it was made from (its prompt, title or
 * caption). The same sexual and undressing words the AI machine's content rules use, plus the
 * Lab's spicy vocabulary. Read from the words alone, so it works for everything already made.
 */
const SEXUAL =
  /\b(nude|nudes|nudity|naked|nsfw|sex|sexual|sexy|porn\w*|explicit|erotic\w*|topless|bottomless|breasts?|boobs?|nipples?|genital\w*|penis|vagina|pussy|cock|dick|orgasm\w*|masturbat\w*|lingerie|undress\w*|strip\w*|seductive|sensual|fetish|bdsm|cum|blowjob|handjob|intercourse|aroused|horny|lewd|hentai|bikini|panties|underwear|thong|spread\s+legs|provocative|intimate|onlyfans|thirst\s*trap\w*|swimwear|swimsuit|bathing\s+suit|shirtless|bare[-\s]chest\w*|see[-\s]?through)\b/;
const UNDRESS =
  /\b(unclothe\w*|remove\s+(her|his|their|the)?\s*(clothes|clothing|shirt|top|dress|bra|pants|underwear)|(?:take|takes|taking|took)\s+off\s+(her|his|their)?\s*(clothes|clothing)|without\s+clothes|x-?ray)\b/;

export function isNsfw(...texts: (string | null | undefined)[]): boolean {
  const t = texts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_*~`#]/g, ' ');
  return SEXUAL.test(t) || UNDRESS.test(t);
}
