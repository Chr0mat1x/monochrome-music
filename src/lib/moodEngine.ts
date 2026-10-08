import type { Track } from '../types'
import { TRACKS } from '../data/library'

export interface MoodQuery {
  energy: number
  valence: number
  bpm: number | null
  genres: string[]
  moods: string[]
  instrumental: boolean
  limit: number
  label: string
}

interface KeywordRule {
  words: string[]
  energy?: number
  valence?: number
  bpm?: number
  genres?: string[]
  moods?: string[]
  instrumental?: boolean
}

/**
 * Bilingual (RU/EN) keyword map. Values are target positions on a 0..100
 * energy/valence plane, mirroring the dimensions stored on every track.
 */
const RULES: KeywordRule[] = [
  { words: ['груст', 'печал', 'тоск', 'уныл', 'слез', 'sad', 'melanchol', 'blue', 'depress'], energy: 30, valence: 15, moods: ['меланхолия', 'грусть'] },
  { words: ['весел', 'радост', 'счастл', 'праздник', 'happy', 'joy', 'cheer', 'upbeat', 'fun'], energy: 68, valence: 88, moods: ['радость'] },
  { words: ['энерг', 'бодр', 'драйв', 'мощн', 'energy', 'energetic', 'power', 'pump', 'drive'], energy: 88, valence: 62, moods: ['энергия', 'драйв'] },
  { words: ['спокой', 'тих', 'умиротвор', 'расслаб', 'relax', 'calm', 'peace', 'chill', 'serene'], energy: 16, valence: 58, moods: ['спокойствие'] },
  { words: ['зл', 'агресс', 'ярост', 'angry', 'rage', 'aggress', 'fury'], energy: 94, valence: 10, moods: ['агрессия', 'злость'], genres: ['Industrial', 'Techno'] },
  { words: ['тревог', 'страх', 'напряж', 'anxious', 'tense', 'fear', 'dark', 'мрак', 'готик'], energy: 62, valence: 12, moods: ['тревога', 'мрак'], genres: ['Darkwave', 'Industrial'] },
  { words: ['романт', 'любов', 'нежн', 'romantic', 'love', 'tender', 'soft'], energy: 34, valence: 72, moods: ['романтика'] },
  { words: ['медитац', 'дыхан', 'йог', 'meditat', 'zen', 'breath', 'mindful'], energy: 8, valence: 52, moods: ['медитация', 'фокус'], genres: ['Ambient', 'Drone'] },
  { words: ['фокус', 'работ', 'код', 'концентрац', 'focus', 'work', 'study', 'cognit', 'deep'], energy: 28, valence: 52, moods: ['фокус', 'работа'], genres: ['Ambient', 'Minimal', 'Drone'] },
  { words: ['учёб', 'учеб', 'study', 'чита', 'книг'], energy: 26, valence: 58, moods: ['учёба', 'фокус'], genres: ['Lo-Fi', 'Ambient'] },
  { words: ['клуб', 'танц', 'вечерин', 'club', 'dance', 'party', 'rave'], energy: 92, valence: 72, moods: ['клуб', 'движение'], genres: ['Techno', 'Breakbeat'] },
  { words: ['трениров', 'спорт', 'бег', 'качал', 'workout', 'gym', 'run', 'sport'], energy: 90, valence: 70, moods: ['спорт', 'драйв'], genres: ['Breakbeat', 'Techno'] },
  { words: ['сон', 'засып', 'колыбел', 'sleep', 'lull', 'insomnia', 'бессонниц'], energy: 6, valence: 46, moods: ['ночь', 'медитация'], genres: ['Ambient', 'Drone'] },
  { words: ['ноч', 'night', 'nocturn', 'полноч', 'midnight'], energy: 42, valence: 30, moods: ['ночь'], genres: ['Synthwave', 'Darkwave', 'Trip-Hop'] },
  { words: ['дожд', 'rain', 'storm', 'гроза', 'пасмур'], energy: 32, valence: 40, moods: ['дождь', 'уют'], genres: ['Lo-Fi', 'Shoegaze'] },
  { words: ['космос', 'space', 'orbit', 'звёзд', 'star', 'галакт', 'вселенн'], energy: 22, valence: 56, moods: ['космос'], genres: ['Ambient', 'Drone'] },
  { words: ['ретро', 'nostalg', 'ностальг', '80', 'синтвейв', 'synthwave', 'vintage'], energy: 64, valence: 74, moods: ['ностальгия', 'ретро'], genres: ['Synthwave'] },
  { words: ['нуар', 'noir', 'детектив', 'шпион', 'city', 'город'], energy: 38, valence: 28, moods: ['нуар', 'город'], genres: ['Jazz Noir', 'Trip-Hop'] },
  { words: ['эпик', 'эпичн', 'героич', 'epic', 'heroic', 'cinemat', 'кино', 'саундтрек'], energy: 58, valence: 40, moods: ['эпик', 'кинематографично'], genres: ['Post-Rock', 'Neo-Classical'] },
  { words: ['мечт', 'dream', 'мечтат', 'шугейз', 'shoegaze', 'воздушн'], energy: 50, valence: 64, moods: ['мечтательность'], genres: ['Shoegaze'] },
  { words: ['индустр', 'industrial', 'механик', 'машин'], energy: 88, valence: 18, moods: ['индустрия', 'хаос'], genres: ['Industrial'] },
  { words: ['джаз', 'jazz', 'саксофон', 'sax', 'блюз', 'blues'], energy: 40, valence: 44, moods: ['нуар'], genres: ['Jazz Noir'] },
  { words: ['лоф', 'lofi', 'lo-fi', 'уют', 'cozy', 'chill'], energy: 24, valence: 68, moods: ['уют', 'учёба'], genres: ['Lo-Fi'] },
  { words: ['пост-рок', 'post-rock', 'пост рок', 'нараст'], energy: 60, valence: 34, moods: ['эпик', 'глубина'], genres: ['Post-Rock'] },
  { words: ['быстр', 'fast', 'скорост', 'speed', 'гонк', 'race', 'поездк', 'road'], energy: 82, valence: 68, bpm: 132, moods: ['драйв', 'поездка'], genres: ['Breakbeat', 'Techno', 'Synthwave'] },
  { words: ['медленн', 'slow', 'неспешн', 'тягуч'], energy: 18, valence: 40, bpm: 66, moods: ['медитация'] },
  { words: ['утро', 'morning', 'рассвет', 'sunrise', 'просып'], energy: 46, valence: 76, moods: ['утро'] },
  { words: ['вечер', 'evening', 'закат', 'sunset', 'сумерк'], energy: 40, valence: 54, moods: ['вечер'] },
  { words: ['зим', 'winter', 'снег', 'snow', 'мороз', 'холод'], energy: 30, valence: 44, moods: ['зима', 'холод'] },
  { words: ['лето', 'summer', 'жар', 'heat', 'пляж', 'beach'], energy: 62, valence: 84, moods: ['лето'] },
  { words: ['осень', 'autumn', 'fall', 'листопад'], energy: 34, valence: 38, moods: ['грусть', 'ностальгия'] },
  { words: ['весн', 'spring', 'цвет'], energy: 50, valence: 72, moods: ['надежда'] },
  { words: ['одиночеств', 'одинок', 'alone', 'lonely', 'изоляц'], energy: 24, valence: 22, moods: ['меланхолия'] },
  { words: ['надежд', 'hope', 'свет', 'light', 'вдохнов', 'inspir'], energy: 46, valence: 80, moods: ['надежда'] },
  { words: ['гипноз', 'hypnot', 'транс', 'trance', 'монотон', 'repetit'], energy: 40, valence: 50, moods: ['гипноз'], genres: ['Minimal', 'Techno', 'Drone'] },
  { words: ['шум', 'noise', 'стена звука', 'wall of sound'], energy: 74, valence: 40, moods: ['шум'], genres: ['Shoegaze', 'Industrial'] },
  { words: ['инструментал', 'instrumental', 'без слов', 'no vocal'], energy: 40, valence: 50, instrumental: true },
]

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'для', 'под', 'из', 'от', 'до', 'по', 'а', 'но',
  'что', 'как', 'это', 'мне', 'хочу', 'сделай', 'плейлист', 'создай', 'музыка', 'музыку',
  'трек', 'треки', 'песня', 'песни', 'настроение', 'под', 'чтобы', 'the', 'a', 'an', 'and',
  'for', 'with', 'to', 'of', 'playlist', 'make', 'create', 'music', 'song', 'songs', 'want',
  'like', 'feel', 'feeling', 'mood', 'vibe', 'some', 'that', 'this',
])

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'ё')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectBpm(text: string): number | null {
  const match = text.match(/(\d{2,3})\s*(bpm|бпм|уд\/(мин|м))?/)
  if (match) {
    const v = parseInt(match[1], 10)
    if (v >= 40 && v <= 220) return v
  }
  const explicit = text.match(/(\d{2,3})\s*(bpm|бпм)/)
  if (explicit) {
    const v = parseInt(explicit[1], 10)
    if (v >= 40 && v <= 220) return v
  }
  return null
}

export function parseMood(text: string, limit = 24): MoodQuery {
  const norm = normalise(text)
  const words = norm.split(' ').filter((w) => w && !STOP_WORDS.has(w))

  let energySum = 0
  let energyN = 0
  let valenceSum = 0
  let valenceN = 0
  let bpmSum = 0
  let bpmN = 0
  const genres = new Set<string>()
  const moods = new Set<string>()
  let instrumental = false
  const matchedLabels: string[] = []

  for (const rule of RULES) {
    const hit = rule.words.some((w) => norm.includes(w))
    if (!hit) continue
    if (rule.energy !== undefined) {
      energySum += rule.energy
      energyN++
    }
    if (rule.valence !== undefined) {
      valenceSum += rule.valence
      valenceN++
    }
    if (rule.bpm !== undefined) {
      bpmSum += rule.bpm
      bpmN++
    }
    rule.genres?.forEach((g) => genres.add(g))
    rule.moods?.forEach((m) => moods.add(m))
    if (rule.instrumental) instrumental = true
    matchedLabels.push(rule.words[0])
  }

  const explicitBpm = detectBpm(norm)

  // Fall back to the description's own words when nothing matched, so the
  // generator always produces something plausible.
  const energy = energyN ? energySum / energyN : 50
  const valence = valenceN ? valenceSum / valenceN : 50
  const bpm = explicitBpm ?? (bpmN ? Math.round(bpmSum / bpmN) : null)

  const label =
    words.length > 0
      ? `«${words.slice(0, 5).join(' ')}»`
      : 'без описания'

  return {
    energy: Math.round(energy),
    valence: Math.round(valence),
    bpm,
    genres: Array.from(genres),
    moods: Array.from(moods),
    instrumental,
    limit,
    label,
  }
}

export interface ScoredTrack {
  track: Track
  score: number
}

/**
 * Ranks the whole catalogue against a parsed mood query. Genre and mood
 * matches dominate; energy/valence proximity and tempo refine the order.
 */
export function scoreTracks(query: MoodQuery): ScoredTrack[] {
  const scored: ScoredTrack[] = TRACKS.map((track) => {
    let score = 0

    // Energy / valence proximity — up to 30 points each.
    score += 30 * (1 - Math.abs(track.energy - query.energy) / 100)
    score += 30 * (1 - Math.abs(track.valence - query.valence) / 100)

    // Tempo proximity — up to 12 points.
    if (query.bpm) {
      score += 12 * (1 - Math.min(1, Math.abs(track.bpm - query.bpm) / 60))
    }

    // Genre affinity — 14 points each, capped.
    if (query.genres.length) {
      const gHits = query.genres.filter((g) => g === track.genre).length
      score += Math.min(28, gHits * 14)
    }

    // Mood tag affinity — 7 points each, capped.
    if (query.moods.length) {
      const mHits = track.mood.filter((m) => query.moods.includes(m)).length
      score += Math.min(21, mHits * 7)
    }

    return { track, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored
}

export interface GeneratedPlaylist {
  name: string
  description: string
  trackIds: string[]
  query: MoodQuery
}

const NAME_TEMPLATES = [
  'Настроение: {w}',
  'Микс · {w}',
  'Поток · {w}',
  'Состояние: {w}',
]

export function generatePlaylist(description: string, limit = 24): GeneratedPlaylist {
  const query = parseMood(description, limit)
  const ranked = scoreTracks(query)
  const trackIds = ranked.slice(0, limit).map((s) => s.track.id)

  const keyWords = normalise(description)
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 3)
    .join(' ')

  const template = NAME_TEMPLATES[keyWords.length % NAME_TEMPLATES.length]
  const name = keyWords
    ? template.replace('{w}', keyWords.charAt(0).toUpperCase() + keyWords.slice(1))
    : 'Плейлист по настроению'

  const parts: string[] = []
  if (query.energy >= 70) parts.push('высокая энергия')
  else if (query.energy <= 30) parts.push('спокойный темп')
  else parts.push('средний темп')
  if (query.valence >= 65) parts.push('светлое настроение')
  else if (query.valence <= 35) parts.push('мрачноватая окраска')
  if (query.genres.length) parts.push(query.genres.join(', ').toLowerCase())
  if (query.bpm) parts.push(`≈ ${query.bpm} BPM`)

  return {
    name,
    description: `Сгенерировано по запросу: «${description.trim()}». Профиль: ${parts.join(' · ')}.`,
    trackIds,
    query,
  }
}
