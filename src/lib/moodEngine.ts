/* ------------------------------------------------------------------ *
 * Bilingual (RU/EN) mood parser.
 * Turns a free-text description into a musical profile plus a set of
 * search terms, which are then sent to the live catalogues. Scoring of
 * the returned tracks happens in the page (see `moodDistance`).
 * ------------------------------------------------------------------ */

export interface MoodQuery {
  energy: number
  valence: number
  bpm: number
  genres: string[]
  terms: string[]
  instrumental: boolean
  title: string
}

interface Rule {
  words: string[]
  energy?: number
  valence?: number
  bpm?: number
  genre?: string
  term?: string
  instrumental?: boolean
  title?: string
}

const RULES: Rule[] = [
  // energy axes
  { words: ['энергичн', 'энергия', 'бодр', 'драйв', 'мощн', 'быстр', 'разгон', 'интенсив', 'тренировк', 'бег', 'спорт'], energy: 90, bpm: 140 },
  { words: ['спокойн', 'тих', 'умиротвор', 'медленн', 'нежн', 'мягк', 'расслаб', 'релакс', 'сон', 'уснуть', 'дрем'], energy: 20, bpm: 78 },
  { words: ['energetic', 'fast', 'driving', 'powerful', 'intense', 'workout', 'gym', 'run'], energy: 90, bpm: 140 },
  { words: ['calm', 'quiet', 'slow', 'gentle', 'soft', 'relax', 'sleep', 'peaceful'], energy: 20, bpm: 78 },

  // valence axes
  { words: ['груст', 'печаль', 'тоск', 'меланхол', 'слез', 'драм', 'уныл', 'одинок', 'разбит', 'боль'], valence: 18 },
  { words: ['радост', 'весел', 'счаст', 'праздник', 'солнечн', 'летн', 'позитив', 'улыб', 'танц'], valence: 88 },
  { words: ['sad', 'melancholy', 'gloomy', 'lonely', 'blue', 'cry'], valence: 18 },
  { words: ['happy', 'joy', 'sunny', 'summer', 'fun', 'party', 'upbeat'], valence: 88 },

  // dark / bright
  { words: ['мрачн', 'тёмн', 'темн', 'зл', 'агресс', 'тяжёл', 'тяжел', 'жутк', 'тревож', 'холодн', 'ночн', 'dark'], valence: 22, energy: 55 },
  { words: ['светл', 'тёпл', 'тепл', 'ярк', 'добр', 'уютн', 'мягк', 'утренн', 'warm', 'bright', 'cozy'], valence: 72 },

  // genres (also feed the search terms)
  { words: ['техно', 'techno'], genre: 'techno', term: 'techno', energy: 88, bpm: 138, title: 'Техно-ночь' },
  { words: ['хаус', 'house'], genre: 'house', term: 'house music', energy: 82, bpm: 126 },
  { words: ['транс', 'trance'], genre: 'trance', term: 'trance', energy: 86, bpm: 138 },
  { words: ['брейкбит', 'breakbeat', 'drum and bass', 'drum & bass', 'dnb'], genre: 'breakbeat', term: 'breakbeat drum and bass', energy: 92, bpm: 172 },
  { words: ['ло-фай', 'лофай', 'lo-fi', 'lofi', 'lo fi'], genre: 'lo-fi', term: 'lofi chillhop', energy: 30, valence: 64, bpm: 84, title: 'Lo-Fi поток' },
  { words: ['эмбиент', 'ambient', 'дрон', 'drone', 'космическ', 'космос', 'space'], genre: 'ambient', term: 'ambient drone', energy: 16, valence: 50, bpm: 70, instrumental: true, title: 'Эмбиент' },
  { words: ['джаз', 'jazz', 'блюз', 'blues', 'нуар', 'noir'], genre: 'jazz', term: 'jazz noir', energy: 42, valence: 48, bpm: 96, title: 'Джаз' },
  { words: ['классик', 'classical', 'пианино', 'piano', 'нео-классик', 'neo-classical', 'оркестр', 'orchestra'], genre: 'classical', term: 'classical piano', energy: 30, valence: 46, bpm: 80, instrumental: true },
  { words: ['рок', 'rock', 'метал', 'metal', 'панк', 'punk', 'пост-рок', 'post-rock'], genre: 'rock', term: 'rock', energy: 80, valence: 45, bpm: 132 },
  { words: ['рэп', 'rap', 'хип-хоп', 'hip-hop', 'hip hop', 'трэп', 'trap'], genre: 'hip-hop', term: 'hip hop rap', energy: 70, bpm: 96 },
  { words: ['поп', 'pop'], genre: 'pop', term: 'pop hits', energy: 68, valence: 82, bpm: 118 },
  { words: ['синтвейв', 'synthwave', 'ретро', 'retro', '80-х', '80s', 'неон', 'neon'], genre: 'synthwave', term: 'synthwave retrowave', energy: 66, valence: 58, bpm: 116 },
  { words: ['дарквейв', 'darkwave', 'готик', 'gothic', 'готика'], genre: 'darkwave', term: 'darkwave gothic', energy: 58, valence: 24, bpm: 124 },
  { words: ['шугейз', 'shoegaze', 'дрим-поп', 'dream pop'], genre: 'shoegaze', term: 'shoegaze dream pop', energy: 52, valence: 44, bpm: 100 },
  { words: ['кантри', 'country', 'фолк', 'folk', 'акустик', 'acoustic'], genre: 'folk', term: 'acoustic folk', energy: 40, valence: 62, bpm: 92 },
  { words: ['регги', 'reggae', 'латина', 'latin', 'афро', 'afro'], genre: 'reggae', term: 'reggae latin', energy: 64, valence: 82, bpm: 102 },
  { words: ['r&b', 'rnb', 'соул', 'soul'], genre: 'r&b', term: 'rnb soul', energy: 52, valence: 64, bpm: 100 },
  { words: ['k-pop', 'kpop', 'j-pop', 'jpop', 'аниме', 'anime'], genre: 'k-pop', term: 'kpop jpop', energy: 82, valence: 86, bpm: 130 },

  // contexts
  { words: ['работ', 'код', 'учёб', 'учеб', 'чита', 'study', 'work', 'focus', 'концентрац'], energy: 32, instrumental: true, title: 'Для работы' },
  { words: ['ночн', 'ночь', 'night', 'полноч'], title: 'Ночной плейлист' },
  { words: ['утр', 'morning', 'рассвет'], valence: 74, title: 'Утро' },
  { words: ['вечер', 'evening', 'закат'], valence: 54, title: 'Вечер' },
  { words: ['дожд', 'rain', 'ливн'], valence: 36, title: 'Под дождь' },
  { words: ['дорог', 'поездк', 'трасс', 'road', 'drive', 'путь'], energy: 70, title: 'В дорогу' },
  { words: ['медитац', 'meditation', 'дзен', 'zen', 'йога', 'yoga'], energy: 14, valence: 56, instrumental: true, title: 'Медитация' },
  { words: ['без слов', 'инструментал', 'instrumental', 'no vocals', 'без вокала'], instrumental: true },
]

export function parseMood(text: string): MoodQuery {
  const t = text.toLowerCase()
  let energy: number | null = null
  let valence: number | null = null
  let bpm: number | null = null
  let instrumental = false
  const genres: string[] = []
  const terms: string[] = []
  let title = ''

  for (const rule of RULES) {
    if (!rule.words.some((w) => t.includes(w))) continue
    if (rule.energy != null) energy = energy == null ? rule.energy : Math.round((energy + rule.energy) / 2)
    if (rule.valence != null) valence = valence == null ? rule.valence : Math.round((valence + rule.valence) / 2)
    if (rule.bpm != null && bpm == null) bpm = rule.bpm
    if (rule.genre && !genres.includes(rule.genre)) genres.push(rule.genre)
    if (rule.term && !terms.includes(rule.term)) terms.push(rule.term)
    if (rule.instrumental) instrumental = true
    if (rule.title && !title) title = rule.title
  }

  // extract a leading tempo number if the user wrote one
  const bpmMatch = t.match(/(\d{2,3})\s*(bpm|бпм)/)
  if (bpmMatch) bpm = Number(bpmMatch[1])

  const finalEnergy = energy ?? 55
  const finalValence = valence ?? (instrumental ? 55 : 58)

  if (!title) {
    if (finalEnergy >= 75) title = finalValence < 40 ? 'Тяжёлый драйв' : 'Разгон'
    else if (finalEnergy <= 30) title = finalValence < 40 ? 'Тихая грусть' : 'Спокойствие'
    else title = finalValence < 40 ? 'Серый день' : 'Ровный поток'
  }

  return {
    energy: finalEnergy,
    valence: finalValence,
    bpm: bpm ?? 0,
    genres,
    terms,
    instrumental,
    title,
  }
}

/** Build the query string actually sent to iTunes/Audius. */
export function buildSearchQuery(q: MoodQuery, raw: string): string {
  if (q.terms.length) return q.terms.slice(0, 3).join(' ')
  // fall back to the raw description with stop-words stripped
  const cleaned = raw
    .toLowerCase()
    .replace(/[«»"'.,!?]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .slice(0, 4)
    .join(' ')
  return cleaned || 'music'
}

/**
 * Fan out into several targeted queries (mood terms plus each genre) so one
 * vague phrase still returns a wide, on-theme pool to rank. `extra` carries the
 * model-authored queries, which are tried first.
 */
export function buildSearchQueries(q: MoodQuery, raw: string, extra: string[] = []): string[] {
  const queries = new Set<string>()
  for (const e of extra) {
    const s = e.trim()
    if (s) queries.add(s)
  }
  const primary = buildSearchQuery(q, raw)
  if (primary) queries.add(primary)
  for (const g of q.genres) queries.add(`${g} music`)
  if (q.instrumental) queries.add(`${q.genres[0] ?? primary} instrumental`)
  return Array.from(queries).slice(0, 6)
}

const STOP = new Set([
  'для', 'под', 'без', 'мне', 'очень', 'что-то', 'что', 'как', 'это', 'музыка', 'музыку', 'настроение',
  'хочу', 'нужно', 'можно', 'если', 'чтобы', 'трек', 'треки', 'песня', 'песни', 'плейлист',
  'for', 'the', 'and', 'with', 'without', 'music', 'songs', 'song', 'playlist', 'mood', 'some',
])
