import type { Album, Artist, Mode, Playlist, Track } from '../types'

/* ------------------------------------------------------------------ *
 * Deterministic PRNG so the catalogue is identical on every reload.
 * ------------------------------------------------------------------ */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const pick = <T,>(r: Rng, arr: T[]): T => arr[Math.floor(r() * arr.length)]
const between = (r: Rng, a: number, b: number) => a + r() * (b - a)
const int = (r: Rng, a: number, b: number) => Math.floor(between(r, a, b + 1))

interface GenreProfile {
  genre: string
  energy: [number, number]
  valence: [number, number]
  bpm: [number, number]
  modes: Mode[]
  waveform: Track['waveform']
  moods: string[]
}

const GENRES: GenreProfile[] = [
  {
    genre: 'Ambient',
    energy: [4, 30],
    valence: [30, 70],
    bpm: [58, 78],
    modes: ['dorian', 'lydian', 'major'],
    waveform: 'sine',
    moods: ['спокойствие', 'медитация', 'космос', 'фокус', 'ночь'],
  },
  {
    genre: 'Lo-Fi',
    energy: [18, 44],
    valence: [42, 78],
    bpm: [68, 92],
    modes: ['dorian', 'major', 'mixolydian'],
    waveform: 'triangle',
    moods: ['учёба', 'уют', 'ностальгия', 'дождь', 'вечер'],
  },
  {
    genre: 'Techno',
    energy: [72, 100],
    valence: [34, 74],
    bpm: [126, 145],
    modes: ['minor', 'phrygian', 'dorian'],
    waveform: 'sawtooth',
    moods: ['клуб', 'движение', 'энергия', 'ночь', 'драйв'],
  },
  {
    genre: 'Post-Rock',
    energy: [46, 88],
    valence: [18, 52],
    bpm: [78, 104],
    modes: ['minor', 'dorian'],
    waveform: 'triangle',
    moods: ['эпик', 'меланхолия', 'глубина', 'размышление', 'дождь'],
  },
  {
    genre: 'Darkwave',
    energy: [40, 74],
    valence: [8, 38],
    bpm: [96, 122],
    modes: ['minor', 'phrygian'],
    waveform: 'sawtooth',
    moods: ['мрак', 'тревога', 'готика', 'ночь', 'холод'],
  },
  {
    genre: 'Neo-Classical',
    energy: [10, 46],
    valence: [22, 64],
    bpm: [52, 84],
    modes: ['minor', 'major', 'dorian'],
    waveform: 'sine',
    moods: ['кинематографично', 'грусть', 'надежда', 'медитация', 'зима'],
  },
  {
    genre: 'Trip-Hop',
    energy: [30, 58],
    valence: [24, 56],
    bpm: [78, 96],
    modes: ['dorian', 'minor', 'phrygian'],
    waveform: 'square',
    moods: ['нуар', 'меланхолия', 'город', 'ночь', 'лёгкая грусть'],
  },
  {
    genre: 'Synthwave',
    energy: [58, 90],
    valence: [48, 84],
    bpm: [100, 122],
    modes: ['minor', 'mixolydian', 'major'],
    waveform: 'sawtooth',
    moods: ['неон', 'ретро', 'поездка', 'вечер', 'ностальгия'],
  },
  {
    genre: 'Drone',
    energy: [2, 22],
    valence: [14, 48],
    bpm: [48, 62],
    modes: ['phrygian', 'dorian', 'minor'],
    waveform: 'sine',
    moods: ['медитация', 'космос', 'пустота', 'глубина', 'фокус'],
  },
  {
    genre: 'Breakbeat',
    energy: [68, 96],
    valence: [46, 86],
    bpm: [128, 148],
    modes: ['dorian', 'mixolydian', 'minor'],
    waveform: 'square',
    moods: ['энергия', 'движение', 'спорт', 'драйв', 'утро'],
  },
  {
    genre: 'Shoegaze',
    energy: [44, 80],
    valence: [28, 62],
    bpm: [86, 110],
    modes: ['major', 'mixolydian', 'lydian'],
    waveform: 'sawtooth',
    moods: ['мечтательность', 'шум', 'тоска', 'размытие', 'лето'],
  },
  {
    genre: 'Minimal',
    energy: [24, 52],
    valence: [34, 68],
    bpm: [112, 126],
    modes: ['dorian', 'phrygian'],
    waveform: 'triangle',
    moods: ['фокус', 'гипноз', 'работа', 'ночь', 'космос'],
  },
  {
    genre: 'Jazz Noir',
    energy: [26, 62],
    valence: [16, 54],
    bpm: [72, 104],
    modes: ['dorian', 'minor', 'mixolydian'],
    waveform: 'triangle',
    moods: ['нуар', 'дым', 'город', 'вечер', 'интрига'],
  },
  {
    genre: 'Industrial',
    energy: [78, 100],
    valence: [6, 34],
    bpm: [118, 150],
    modes: ['phrygian', 'minor'],
    waveform: 'square',
    moods: ['агрессия', 'мрак', 'злость', 'индустрия', 'хаос'],
  },
]

const ARTIST_NAMES = [
  'Ночная Смена', 'Vanta', 'Полярный', 'Северный Ветер', 'Obsidian Choir',
  'Тихий Омут', 'Grayscale Youth', 'Метроном', 'Static Bloom', 'Пепел и Неон',
  'Кассетный Сон', 'Monolith', 'Ржавый Луч', 'Halcyon Drift', 'Стеклянный Сад',
  'Zero Fog', 'Пульс Пустоты', 'Coldwave Kids', 'Медленный Свет', 'Archiv',
]

const ALBUM_WORDS_A = ['Тёмный', 'Тихий', 'Вечный', 'Стеклянный', 'Холодный', 'Размытый', 'Ночной', 'Пустой', 'Последний', 'Внутренний']
const ALBUM_WORDS_B = ['этаж', 'горизонт', 'сигнал', 'город', 'сезон', 'архив', 'предел', 'контур', 'фрагмент', 'маяк']

const TRACK_WORDS = [
  'Инерция', 'Полутон', 'Тень на стене', 'Первый снег', 'Дрейф', 'Молчание',
  'Разрыв', 'Петля', 'Глубина', 'Север', 'Пыль', 'Резонанс', 'Отблеск',
  'Ночная трасса', 'Пустой вагон', 'Туман', 'Второй шанс', 'Кислород',
  'Медленный огонь', 'Асфальт', 'Стекло', 'Орбита', 'Штиль', 'Искра',
  'Без адреса', 'Полночь', 'Дальний свет', 'Пар', 'Кадр', 'Зима внутри',
  'Тишина после', 'Пепел', 'Магнит', 'Сбой', 'Ртуть', 'Небо в целлофане',
  'Пустой зал', 'Гравитация', 'Осколок', 'Пелена', 'Хроника', 'Антенна',
  'Серый день', 'Долгий путь', 'Оттепель', 'Морок', 'Сигнал потерян',
  'Тонкая грань', 'Пустошь', 'Камертон', 'Река без имени', 'Сон наяву',
]

function buildCatalogue() {
  const rng = mulberry32(0xc0ffee)
  const artists: Artist[] = []
  const albums: Album[] = []
  const tracks: Track[] = []
  const albumTitleUsed = new Set<string>()
  const trackTitleUsed = new Set<string>()

  ARTIST_NAMES.forEach((name, ai) => {
    const profileCount = int(rng, 1, 2)
    const profiles: GenreProfile[] = []
    for (let i = 0; i < profileCount; i++) {
      const p = pick(rng, GENRES)
      if (!profiles.find((x) => x.genre === p.genre)) profiles.push(p)
    }
    const artist: Artist = {
      id: `ar-${ai}`,
      name,
      genres: profiles.map((p) => p.genre),
      bio: '',
      monthly: int(rng, 18_000, 4_200_000),
    }
    artist.bio = `${name} — проект на стыке ${profiles.map((p) => p.genre.toLowerCase()).join(' и ')}. Звук собран из полевых записей, аналоговых синтезаторов и намеренной тишины.`
    artists.push(artist)

    const albumCount = int(rng, 1, 3)
    for (let al = 0; al < albumCount; al++) {
      const profile = profiles[al % profiles.length]
      let albumTitle = `${pick(rng, ALBUM_WORDS_A)} ${pick(rng, ALBUM_WORDS_B)}`
      let guard = 0
      while (albumTitleUsed.has(albumTitle) && guard++ < 20) {
        albumTitle = `${pick(rng, ALBUM_WORDS_A)} ${pick(rng, ALBUM_WORDS_B)}`
      }
      albumTitleUsed.add(albumTitle)

      const year = int(rng, 2016, 2025)
      const trackCount = int(rng, 4, 8)
      const albumId = `al-${ai}-${al}`
      const trackIds: string[] = []

      for (let ti = 0; ti < trackCount; ti++) {
        let title = pick(rng, TRACK_WORDS)
        let g2 = 0
        while (trackTitleUsed.has(`${name}:${title}`) && g2++ < 30) title = pick(rng, TRACK_WORDS)
        trackTitleUsed.add(`${name}:${title}`)

        const energy = Math.round(between(rng, profile.energy[0], profile.energy[1]))
        const valence = Math.round(between(rng, profile.valence[0], profile.valence[1]))
        const bpm = Math.round(between(rng, profile.bpm[0], profile.bpm[1]))

        // Longer, calmer tracks; shorter, punchier ones when energetic.
        const duration = Math.round(between(rng, 118, 300) + (energy < 40 ? between(rng, 20, 90) : 0))

        const moodCount = int(rng, 2, 3)
        const mood: string[] = []
        while (mood.length < moodCount) {
          const m = pick(rng, profile.moods)
          if (!mood.includes(m)) mood.push(m)
        }

        const id = `tr-${ai}-${al}-${ti}`
        tracks.push({
          id,
          title,
          artist: name,
          album: albumTitle,
          duration,
          genre: profile.genre,
          year,
          energy,
          valence,
          bpm,
          mood,
          seed: int(rng, 1, 2 ** 30),
          key: int(rng, 0, 11),
          mode: pick(rng, profile.modes),
          waveform: profile.waveform,
        })
        trackIds.push(id)
      }

      albums.push({
        id: albumId,
        title: albumTitle,
        artist: name,
        year,
        trackIds,
        accent: Math.round(between(rng, 10, 60)),
      })
    }
  })

  return { artists, albums, tracks }
}

const catalogue = buildCatalogue()

export const TRACKS: Track[] = catalogue.tracks
export const ALBUMS: Album[] = catalogue.albums
export const ARTISTS: Artist[] = catalogue.artists

export const TRACK_BY_ID = new Map(TRACKS.map((t) => [t.id, t]))
export const ALBUM_BY_ID = new Map(ALBUMS.map((a) => [a.id, a]))
export const ARTIST_BY_NAME = new Map(ARTISTS.map((a) => [a.name, a]))

export const getTrack = (id: string): Track | undefined => TRACK_BY_ID.get(id)
export const tracksByIds = (ids: string[]): Track[] =>
  ids.map((id) => TRACK_BY_ID.get(id)).filter((t): t is Track => Boolean(t))

export function artistAlbums(name: string): Album[] {
  return ALBUMS.filter((a) => a.artist === name)
}
export function artistTracks(name: string): Track[] {
  return TRACKS.filter((t) => t.artist === name)
}

export const ALL_GENRES = Array.from(new Set(TRACKS.map((t) => t.genre))).sort()

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatMonthly(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс.`
  return `${n}`
}

/* ------------------------------------------------------------------ *
 * Curated starter playlists
 * ------------------------------------------------------------------ */
function pickBy(predicate: (t: Track) => boolean, count: number, offset = 0): string[] {
  const pool = TRACKS.filter(predicate)
  return pool.slice(offset, offset + count).map((t) => t.id)
}

export const STARTER_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-focus',
    name: 'Глубокий фокус',
    description: 'Минимум слов, максимум концентрации. Для работы, кода и чтения.',
    trackIds: pickBy((t) => t.energy < 45 && (t.genre === 'Ambient' || t.genre === 'Minimal' || t.genre === 'Drone'), 22),
    cover: 'focus',
    owned: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 40,
  },
  {
    id: 'pl-night',
    name: 'Ночная трасса',
    description: 'Неон, асфальт и пустой город после полуночи.',
    trackIds: pickBy((t) => t.genre === 'Synthwave' || t.genre === 'Darkwave' || t.genre === 'Trip-Hop', 24, 3),
    cover: 'night',
    owned: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 21,
  },
  {
    id: 'pl-energy',
    name: 'Разгон',
    description: 'Клубный темп, брейкбит и индустриальная злость. Для тренировки.',
    trackIds: pickBy((t) => t.energy > 72, 26),
    cover: 'energy',
    owned: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
  },
  {
    id: 'pl-melancholy',
    name: 'Серый день',
    description: 'Медленная грусть и красивая безысходность.',
    trackIds: pickBy((t) => t.valence < 34 && t.energy < 70, 24, 5),
    cover: 'melancholy',
    owned: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
  },
  {
    id: 'pl-rain',
    name: 'Дождь за окном',
    description: 'Lo-Fi, шугейз и тёплая ностальгия под шум ливня.',
    trackIds: pickBy((t) => t.genre === 'Lo-Fi' || t.genre === 'Shoegaze' || t.mood.includes('дождь'), 22, 2),
    cover: 'rain',
    owned: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
  },
]
