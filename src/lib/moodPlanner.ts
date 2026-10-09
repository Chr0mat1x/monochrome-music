/* ------------------------------------------------------------------ *
 * Natural-language understanding for the mood generator.
 *
 * The old parser only pattern-matched a fixed set of keywords and sent the
 * literal words to the catalogues. This planner instead *reads* the
 * description: it recognises concepts across three axes — genre, mood and
 * context — plus references ("как у Massive Attack"), then composes concrete
 * English search queries, a musical profile, a Russian "here is how I
 * understood you" summary and a set of example artists that steer ranking.
 *
 * A free text model is tried first as an optional enhancement, but the local
 * planner is the source of truth, so generation works online, offline (APK)
 * and when the model is unreachable.
 * ------------------------------------------------------------------ */
import { parseMood, type MoodQuery } from './moodEngine'

const LLM_URL = 'https://text.pollinations.ai/openai'
const LLM_MODEL = 'openai'
const LLM_TIMEOUT = 2500

export interface MoodPlan {
  /** Search queries to send to the catalogues, best first. */
  queries: string[]
  /** Musical profile; energy/valence are 0–100. */
  profile: {
    energy: number
    valence: number
    bpm: number
    genres: string[]
    instrumental: boolean
  }
  /** One-line "here is how I understood you" shown above the playlist. */
  summary: string
  /** Short playlist title. */
  title: string
  /** Example artists that fit the description (steers ranking). */
  artists: string[]
  /** True when a text model contributed to this plan. */
  fromModel: boolean
}

type Kind = 'genre' | 'mood' | 'context'

interface Concept {
  kind: Kind
  /** Lower-case substrings; any hit activates the concept. */
  match: string[]
  /** Russian label used in the summary. */
  label: string
  genres?: string[]
  queries?: string[]
  artists?: string[]
  energy?: number
  valence?: number
  bpm?: number
  instrumental?: boolean
  title?: string
  /** English adjective used to compose "<adj> <genre>" queries. */
  adj?: string
}

const CONCEPTS: Concept[] = [
  /* ------------------------------- genres ------------------------------- */
  { kind: 'genre', match: ['техно', 'techno'], label: 'техно', genres: ['techno'], adj: 'techno', queries: ['dark techno', 'acid techno', 'melodic techno'], artists: ['Charlotte de Witte', 'Amelie Lens', 'Boris Brejcha', 'Adam Beyer'], energy: 88, bpm: 138, title: 'Техно' },
  { kind: 'genre', match: ['хаус', 'house'], label: 'хаус', genres: ['house'], adj: 'house', queries: ['deep house', 'tech house'], artists: ['Fisher', 'Chris Lake', 'Claptone'], energy: 82, bpm: 126 },
  { kind: 'genre', match: ['транс', 'trance'], label: 'транс', genres: ['trance'], adj: 'trance', queries: ['uplifting trance', 'progressive trance'], artists: ['Armin van Buuren', 'Above & Beyond'], energy: 86, bpm: 138 },
  { kind: 'genre', match: ['брейкбит', 'breakbeat', 'drum and bass', 'drum & bass', 'dnb', 'джангл'], label: 'брейкбит/dnb', genres: ['breakbeat'], adj: 'breakbeat', queries: ['drum and bass', 'liquid dnb', 'breakbeat'], artists: ['Pendulum', 'Netsky', 'Sub Focus'], energy: 92, bpm: 172 },
  { kind: 'genre', match: ['ло-фай', 'лофай', 'lo-fi', 'lofi', 'lo fi', 'чиллхоп'], label: 'lo-fi', genres: ['lo-fi'], adj: 'lofi', queries: ['lofi hip hop', 'chillhop', 'lo-fi beats'], artists: ['Nujabes', 'Idealism', 'Jinsang'], energy: 30, valence: 62, bpm: 84, instrumental: true, title: 'Lo-Fi' },
  { kind: 'genre', match: ['эмбиент', 'ambient', 'дрон', 'drone', 'космическ', 'космос', 'space'], label: 'эмбиент', genres: ['ambient'], adj: 'ambient', queries: ['ambient drone', 'space ambient', 'dark ambient'], artists: ['Brian Eno', 'Aphex Twin', 'Stars of the Lid'], energy: 16, valence: 50, bpm: 70, instrumental: true, title: 'Эмбиент' },
  { kind: 'genre', match: ['джаз', 'jazz', 'блюз', 'blues', 'нуар', 'noir', 'свинг'], label: 'джаз', genres: ['jazz'], adj: 'jazz', queries: ['jazz noir', 'smooth jazz', 'bebop'], artists: ['Miles Davis', 'John Coltrane', 'Bill Evans'], energy: 42, valence: 48, bpm: 96, title: 'Джаз' },
  { kind: 'genre', match: ['классик', 'classical', 'пианино', 'piano', 'нео-классик', 'neo-classical', 'оркестр', 'orchestra', 'фортепиано'], label: 'неоклассика', genres: ['classical'], adj: 'piano', queries: ['neo-classical piano', 'modern classical', 'cinematic piano'], artists: ['Ludovico Einaudi', 'Olafur Arnalds', 'Max Richter'], energy: 30, valence: 46, bpm: 80, instrumental: true, title: 'Неоклассика' },
  { kind: 'genre', match: ['пост-рок', 'post-rock', 'пост рок'], label: 'пост-рок', genres: ['post-rock'], adj: 'post-rock', queries: ['post-rock', 'explosions in the sky'], artists: ['Explosions in the Sky', 'Mogwai', 'Godspeed You! Black Emperor'], energy: 62, valence: 42, bpm: 100, instrumental: true },
  { kind: 'genre', match: ['метал', 'metal', 'металкор', 'metalcore', 'дум', 'doom'], label: 'метал', genres: ['metal'], adj: 'metal', queries: ['heavy metal', 'metalcore', 'doom metal'], artists: ['Metallica', 'Gojira', 'Opeth'], energy: 92, valence: 30, bpm: 150 },
  { kind: 'genre', match: ['рок', 'rock', 'панк', 'punk'], label: 'рок', genres: ['rock'], adj: 'rock', queries: ['classic rock', 'alternative rock', 'indie rock'], artists: ['Queen', 'Nirvana', 'Arctic Monkeys'], energy: 80, valence: 45, bpm: 132 },
  { kind: 'genre', match: ['рэп', 'rap', 'хип-хоп', 'hip-hop', 'hip hop', 'трэп', 'trap', 'бумпап'], label: 'хип-хоп', genres: ['hip-hop'], adj: 'hip hop', queries: ['hip hop', 'boom bap', 'trap'], artists: ['Kendrick Lamar', 'J. Cole', 'Travis Scott'], energy: 70, bpm: 96 },
  { kind: 'genre', match: ['поп', 'pop'], label: 'поп', genres: ['pop'], adj: 'pop', queries: ['pop hits', 'synth pop'], artists: ['Dua Lipa', 'The Weeknd', 'Harry Styles'], energy: 68, valence: 82, bpm: 118 },
  { kind: 'genre', match: ['синтвейв', 'synthwave', 'ретро', 'retro', '80-х', '80s', 'неон', 'neon'], label: 'синтвейв', genres: ['synthwave'], adj: 'synthwave', queries: ['synthwave', 'retrowave', 'darksynth'], artists: ['The Midnight', 'Timecop1983', 'Carpenter Brut'], energy: 66, valence: 58, bpm: 116 },
  { kind: 'genre', match: ['дарквейв', 'darkwave', 'готик', 'gothic', 'готика'], label: 'дарквейв', genres: ['darkwave'], adj: 'darkwave', queries: ['darkwave', 'gothic rock', 'cold wave'], artists: ['The Cure', 'Bauhaus', 'Lebanon Hanover'], energy: 58, valence: 24, bpm: 124 },
  { kind: 'genre', match: ['шугейз', 'shoegaze', 'дрим-поп', 'dream pop', 'дримпоп'], label: 'шугейз', genres: ['shoegaze'], adj: 'shoegaze', queries: ['shoegaze', 'dream pop'], artists: ['My Bloody Valentine', 'Beach House', 'Slowdive'], energy: 52, valence: 44, bpm: 100 },
  { kind: 'genre', match: ['кантри', 'country', 'фолк', 'folk', 'акустик', 'acoustic'], label: 'фолк', genres: ['folk'], adj: 'acoustic', queries: ['acoustic folk', 'indie folk'], artists: ['Bon Iver', 'Fleet Foxes', 'Mumford & Sons'], energy: 40, valence: 62, bpm: 92 },
  { kind: 'genre', match: ['регги', 'reggae', 'даб', 'dub', 'латина', 'latin', 'афро', 'afro'], label: 'регги/латина', genres: ['reggae'], adj: 'reggae', queries: ['reggae', 'dub', 'latin'], artists: ['Bob Marley', 'Bomba Estereo'], energy: 64, valence: 82, bpm: 102 },
  { kind: 'genre', match: ['r&b', 'rnb', 'соул', 'soul', 'нео-соул'], label: 'r&b/соул', genres: ['r&b'], adj: 'rnb', queries: ['neo soul', 'r&b'], artists: ['Frank Ocean', 'SZA', 'H.E.R.'], energy: 52, valence: 64, bpm: 100 },
  { kind: 'genre', match: ['k-pop', 'kpop', 'j-pop', 'jpop', 'аниме', 'anime'], label: 'k-pop/аниме', genres: ['k-pop'], adj: 'kpop', queries: ['kpop', 'jpop', 'anime opening'], artists: ['BTS', 'Yoasobi'], energy: 82, valence: 86, bpm: 130 },
  { kind: 'genre', match: ['фанк', 'funk', 'диско', 'disco'], label: 'фанк', genres: ['funk'], adj: 'funk', queries: ['funk', 'disco'], artists: ['Vulfpeck', 'Earth, Wind & Fire'], energy: 74, valence: 84, bpm: 112 },
  { kind: 'genre', match: ['индастриал', 'industrial', 'ebm'], label: 'индастриал', genres: ['industrial'], adj: 'industrial', queries: ['industrial techno', 'EBM'], artists: ['Front 242', 'Nitzer Ebb'], energy: 90, valence: 26, bpm: 140 },
  { kind: 'genre', match: ['idm', 'глитч', 'glitch', 'эксперимент'], label: 'idm', genres: ['idm'], adj: 'idm', queries: ['IDM', 'glitch'], artists: ['Aphex Twin', 'Boards of Canada'], energy: 55, valence: 52, bpm: 110 },

  /* -------------------------------- moods ------------------------------- */
  { kind: 'mood', match: ['мрачн', 'тёмн', 'темн', 'зл', 'жутк', 'холодн', 'dark', 'gloom'], label: 'мрачное', adj: 'dark', queries: ['dark'], energy: 55, valence: 20 },
  { kind: 'mood', match: ['груст', 'печаль', 'тоск', 'меланхол', 'слез', 'уныл', 'одинок', 'разбит', 'sad', 'melancholy', 'blue'], label: 'грустное', adj: 'sad', queries: ['sad'], energy: 38, valence: 16 },
  { kind: 'mood', match: ['радост', 'весел', 'счаст', 'праздник', 'солнечн', 'позитив', 'улыб', 'happy', 'joy', 'upbeat'], label: 'радостное', adj: 'happy', queries: ['happy'], energy: 72, valence: 88 },
  { kind: 'mood', match: ['энергичн', 'энергия', 'бодр', 'драйв', 'мощн', 'быстр', 'разгон', 'интенсив', 'energetic', 'driving', 'powerful'], label: 'энергичное', adj: 'energetic', queries: ['energetic'], energy: 90, bpm: 140 },
  { kind: 'mood', match: ['спокойн', 'тих', 'умиротвор', 'медленн', 'нежн', 'мягк', 'расслаб', 'релакс', 'calm', 'quiet', 'slow', 'gentle', 'relax'], label: 'спокойное', adj: 'calm', queries: ['calm'], energy: 20, bpm: 78 },
  { kind: 'mood', match: ['мечтательн', 'воздушн', 'dreamy', 'ethereal'], label: 'мечтательное', adj: 'dreamy', queries: ['dreamy'], energy: 38, valence: 60 },
  { kind: 'mood', match: ['агресс', 'тяжёл', 'тяжел', 'зло', 'aggressive', 'heavy'], label: 'агрессивное', adj: 'aggressive', queries: ['aggressive'], energy: 92, valence: 30, bpm: 150 },
  { kind: 'mood', match: ['романтичн', 'любов', 'romantic', 'love'], label: 'романтичное', adj: 'romantic', queries: ['romantic'], energy: 45, valence: 72 },
  { kind: 'mood', match: ['ностальг', 'nostalg', 'винтаж', 'vintage'], label: 'ностальгическое', adj: 'nostalgic', queries: ['nostalgic'], energy: 55, valence: 56 },
  { kind: 'mood', match: ['эпичн', 'эпик', 'велич', 'epic', 'cinematic'], label: 'эпичное', adj: 'epic', queries: ['epic'], energy: 82, valence: 52, bpm: 120 },
  { kind: 'mood', match: ['психодел', 'триппи', 'psychedelic', 'trippy'], label: 'психоделическое', adj: 'psychedelic', queries: ['psychedelic'], energy: 60, valence: 55 },
  { kind: 'mood', match: ['тревож', 'напряж', 'anxious', 'tense'], label: 'тревожное', adj: 'tense', queries: ['tense'], energy: 60, valence: 24 },
  { kind: 'mood', match: ['светл', 'тёпл', 'тепл', 'ярк', 'добр', 'уютн', 'утренн', 'warm', 'bright', 'cozy'], label: 'тёплое', adj: 'warm', energy: 42, valence: 74 },

  /* ------------------------------ contexts ------------------------------ */
  { kind: 'context', match: ['ночн', 'ночь', 'night', 'полноч'], label: 'для ночи', queries: ['late night'], title: 'Ночной плейлист' },
  { kind: 'context', match: ['дорог', 'поездк', 'трасс', 'road', 'drive', 'путь', 'рул'], label: 'в дорогу', queries: ['night drive', 'road trip'], energy: 70, title: 'В дорогу' },
  { kind: 'context', match: ['работ', 'код', 'учёб', 'учеб', 'чита', 'study', 'work', 'focus', 'концентрац', 'программ'], label: 'для работы', queries: ['study beats', 'focus music'], instrumental: true, energy: 32, title: 'Для работы' },
  { kind: 'context', match: ['тренировк', 'спорт', 'бег', 'качал', 'workout', 'gym', 'run'], label: 'для тренировки', queries: ['workout music', 'gym motivation'], energy: 90, bpm: 140, title: 'Тренировка' },
  { kind: 'context', match: ['сон', 'уснуть', 'дрем', 'sleep'], label: 'для сна', queries: ['sleep music', 'deep sleep'], energy: 12, valence: 52, title: 'Для сна' },
  { kind: 'context', match: ['дожд', 'rain', 'ливн'], label: 'под дождь', queries: ['rainy day'], valence: 36, title: 'Под дождь' },
  { kind: 'context', match: ['утр', 'morning', 'рассвет'], label: 'утреннее', queries: ['morning'], valence: 74, title: 'Утро' },
  { kind: 'context', match: ['вечер', 'evening', 'закат', 'sunset'], label: 'вечернее', queries: ['evening'], valence: 52, title: 'Вечер' },
  { kind: 'context', match: ['медитац', 'meditation', 'дзен', 'zen', 'йога', 'yoga'], label: 'для медитации', queries: ['meditation', 'zen'], energy: 12, valence: 56, instrumental: true, title: 'Медитация' },
  { kind: 'context', match: ['вечеринк', 'тусовк', 'клуб', 'party', 'club'], label: 'для вечеринки', queries: ['party', 'club hits'], energy: 86, valence: 84, title: 'Вечеринка' },
  { kind: 'context', match: ['ужин', 'dinner', 'ресторан'], label: 'на ужин', queries: ['dinner jazz'], valence: 60, title: 'Ужин' },
  { kind: 'context', match: ['игр', 'gaming', 'game'], label: 'для игр', queries: ['gaming music'], energy: 78, valence: 60 },
  { kind: 'context', match: ['без слов', 'инструментал', 'instrumental', 'no vocals', 'без вокала'], label: 'без слов', instrumental: true },
]

const STOP = new Set([
  'для', 'под', 'без', 'мне', 'очень', 'что-то', 'что', 'как', 'это', 'музыка', 'музыку', 'настроение',
  'хочу', 'нужно', 'можно', 'если', 'чтобы', 'трек', 'треки', 'песня', 'песни', 'плейлист', 'стиле',
  'похоже', 'наподобие', 'дай', 'сделай', 'собери', 'подбери', 'немного', 'более', 'менее',
  'for', 'the', 'and', 'with', 'without', 'music', 'songs', 'song', 'playlist', 'mood', 'some', 'like',
  'style', 'more', 'less', 'very', 'something', 'feel', 'feeling', 'vibe', 'vibes',
])

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))

/** Pull out an artist reference from phrases like "как у X", "в стиле X", "like X". */
function extractReference(text: string): string | null {
  const m = text.match(
    /(?:как у|в стиле|похож\w*\s+на|наподобие|что-то вроде|типа|\blike\b|\bsimilar to\b|\bin the style of\b)\s+([^,.;!?()]+)/i,
  )
  if (!m) return null
  const name = m[1].trim().split(/\s+(?:но|and|для|под|без|for|with)\s+/i)[0].trim()
  return name.length > 1 && name.length <= 40 ? name : null
}

interface Draft {
  concepts: Concept[]
  reference: string | null
}

function detect(text: string): Draft {
  const t = text.toLowerCase()
  const concepts = CONCEPTS.filter((c) => c.match.some((w) => t.includes(w)))
  return { concepts, reference: extractReference(text) }
}

/** Latin-script words from the description that the lexicon did not cover. */
function strayWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && /[a-z]/.test(w) && !STOP.has(w))
}

function buildQueries(draft: Draft, raw: string, modelQueries: string[]): string[] {
  const out: string[] = []
  const add = (q?: string) => {
    const s = q?.trim().toLowerCase()
    if (s && !out.includes(s)) out.push(s)
  }

  // model-authored queries lead when available
  for (const q of modelQueries) add(q)

  const genreConcepts = draft.concepts.filter((c) => c.kind === 'genre')
  const moods = draft.concepts.filter((c) => c.kind === 'mood')

  // compose "<mood adj> <genre>" — the phrasing that actually finds the vibe
  for (const g of genreConcepts) {
    const genre = g.genres?.[0]
    if (!genre) continue
    for (const m of moods) if (m.adj) add(`${m.adj} ${genre}`)
    add(`${genre} music`)
    for (const q of g.queries ?? []) add(q)
  }
  if (!genreConcepts.length) {
    for (const m of moods) for (const q of m.queries ?? []) add(q)
  }

  // contexts and their specific phrasings
  for (const c of draft.concepts.filter((x) => x.kind === 'context')) for (const q of c.queries ?? []) add(q)

  // an explicit "like X" also drives a search for X itself
  if (draft.reference) {
    const ref = draft.reference.toLowerCase()
    add(ref)
    for (const m of moods) if (m.adj) add(`${m.adj} ${ref}`)
  }

  // as a last resort, whatever latin words the user wrote
  if (!out.length) for (const w of strayWords(raw).slice(0, 3)) add(w)

  return out.slice(0, 5)
}

const ENERGY_LABEL = (e: number) => (e >= 75 ? 'энергично' : e <= 30 ? 'спокойно' : 'средний темп')
const VALENCE_LABEL = (v: number) => (v <= 35 ? 'мрачно/грустно' : v >= 70 ? 'светло/радостно' : 'нейтрально')

function summarize(draft: Draft, energy: number, valence: number, bpm: number): string {
  const bits = draft.concepts.map((c) => c.label)
  if (draft.reference) bits.push(`как у ${draft.reference}`)
  const what = bits.length ? bits.join(', ') : 'музыка по описанию'
  const tempo = bpm ? `, ~${bpm} BPM` : ''
  return `${ENERGY_LABEL(energy)}, ${VALENCE_LABEL(valence)}${tempo} — ${what}`
}

function pickTitle(draft: Draft, raw: string, energy: number, valence: number): string {
  const named = draft.concepts.find((c) => c.title)
  if (named?.title) return named.title
  if (!draft.concepts.length) return parseMood(raw).title
  if (energy >= 75) return valence < 40 ? 'Тяжёлый драйв' : 'Разгон'
  if (energy <= 30) return valence < 40 ? 'Тихая грусть' : 'Спокойствие'
  return valence < 40 ? 'Серый день' : 'Ровный поток'
}

/** The rule-based plan, used when nothing else recognises the description. */
function fallbackPlan(text: string): MoodPlan {
  const q = parseMood(text)
  return {
    queries: [],
    profile: { energy: q.energy, valence: q.valence, bpm: q.bpm, genres: q.genres, instrumental: q.instrumental },
    summary: '',
    title: q.title,
    artists: [],
    fromModel: false,
  }
}

/** Build a plan from the description alone, with no network. Also used for the
 *  live profile preview, so the meters show understanding as you type. */
export function planMoodLocal(text: string): MoodPlan {
  const draft = detect(text)
  const { concepts, reference } = draft
  if (!concepts.length && !reference) return fallbackPlan(text)

  const energies = concepts.filter((c) => c.energy != null)
  const valences = concepts.filter((c) => c.valence != null)
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)

  // A genre pins the intended sound, so trust its energy most; mood words nudge.
  const genreEnergy = concepts.filter((c) => c.kind === 'genre' && c.energy != null).map((c) => c.energy!)
  const energy = clamp(genreEnergy.length ? avg(genreEnergy) : energies.length ? avg(energies.map((c) => c.energy!)) : 55, 0, 100)
  const valence = clamp(valences.length ? avg(valences.map((c) => c.valence!)) : 58, 0, 100)
  const bpm = concepts.find((c) => c.bpm != null)?.bpm ?? 0
  const instrumental = concepts.some((c) => c.instrumental === true)
  const genres = Array.from(new Set(concepts.flatMap((c) => c.genres ?? []))).slice(0, 3)
  const artists = Array.from(new Set(concepts.flatMap((c) => c.artists ?? []))).slice(0, 6)
  if (reference) artists.unshift(reference)

  return {
    queries: buildQueries(draft, text, []),
    profile: { energy, valence, bpm, genres, instrumental },
    summary: summarize(draft, energy, valence, bpm),
    title: pickTitle(draft, text, energy, valence),
    artists,
    fromModel: false,
  }
}

/* ------------------------- optional model overlay ------------------------- */

const PROMPT = `Ты — музыкальный куратор. Пользователь описал настроение или ситуацию. Пойми смысл и подбери, что искать в музыкальных каталогах.
Верни СТРОГО один JSON-объект без markdown и пояснений:
{"queries":["4-6 английских поисковых строк до 5 слов"],"genres":["до 3 жанров"],"energy":50,"valence":50,"bpm":100,"instrumental":false,"artists":["3-6 исполнителей"],"summary":"как понял, по-русски","title":"название по-русски"}`

async function callModel(text: string, signal: AbortSignal): Promise<any | null> {
  const res = await fetch(LLM_URL, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  const a = content.indexOf('{')
  const b = content.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(content.slice(a, b + 1))
  } catch {
    return null
  }
}

const asStrings = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.trim()).slice(0, max)
    : []

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then((v) => {
      clearTimeout(timer)
      resolve(v)
    }).catch(() => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

/**
 * Read the description and turn it into a generation plan. The local planner
 * always runs; a free text model is raced against a short timeout and, when it
 * returns usable data, its queries/profile/summary enrich the result.
 */
export async function planMood(text: string): Promise<MoodPlan> {
  const trimmed = text.trim()
  if (!trimmed) return fallbackPlan(text)
  const base = planMoodLocal(text)

  const ctrl = new AbortController()
  const raw = await withTimeout(callModel(trimmed, ctrl.signal), LLM_TIMEOUT)
  ctrl.abort()
  if (!raw || typeof raw !== 'object') return base

  const modelQueries = asStrings(raw.queries, 6)
  const modelGenres = asStrings(raw.genres, 3).map((g) => g.toLowerCase())
  if (!modelQueries.length && !modelGenres.length) return base

  const draft = detect(text)
  const queries = buildQueries(draft, text, modelQueries)
  const genres = Array.from(new Set([...modelGenres, ...base.profile.genres])).slice(0, 3)
  const artists = Array.from(new Set([...asStrings(raw.artists, 6), ...base.artists])).slice(0, 6)
  const profile = {
    energy: typeof raw.energy === 'number' ? clamp(raw.energy, 0, 100) : base.profile.energy,
    valence: typeof raw.valence === 'number' ? clamp(raw.valence, 0, 100) : base.profile.valence,
    bpm: typeof raw.bpm === 'number' ? clamp(raw.bpm, 0, 300) : base.profile.bpm,
    genres,
    instrumental: typeof raw.instrumental === 'boolean' ? raw.instrumental : base.profile.instrumental,
  }

  return {
    queries,
    profile,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 200) : base.summary,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 40) : base.title,
    artists,
    fromModel: true,
  }
}

/** The planned profile as the MoodQuery the rest of the app expects. */
export function planToQuery(plan: MoodPlan): MoodQuery {
  return {
    energy: plan.profile.energy,
    valence: plan.profile.valence,
    bpm: plan.profile.bpm,
    genres: plan.profile.genres,
    terms: plan.queries,
    instrumental: plan.profile.instrumental,
    title: plan.title,
  }
}
