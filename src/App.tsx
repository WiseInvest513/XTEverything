import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { toPng } from 'html-to-image'
import './App.css'

type RatioKey = '3:4' | '9:16'
type ThemeMode = 'light' | 'dark'
type Lang = 'zh' | 'en'

function ActionIcon({
  path,
  kind,
}: {
  path: string
  kind: 'reply' | 'repost' | 'like' | 'bookmark' | 'share'
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`action-icon action-icon-${kind}`}>
      <path
        d={path}
        fill="currentColor"
      />
    </svg>
  )
}

const RATIO_MAP: Record<RatioKey, { w: number; h: number }> = {
  '3:4': { w: 3, h: 4 },
  '9:16': { w: 9, h: 16 },
}

const PREVIEW_WIDTH = 360

const TEXTS: Record<
  Lang,
  {
    title: string
    inputPanel: string
    previewPanel: string
    username: string
    handle: string
    ratio: string
    theme: string
    displayLanguage: string
    avatar: string
    media: string
    content: string
    contentZoom: string
    contentCollapse: string
    addImage: string
    stats: string
    comments: string
    reposts: string
    likes: string
    bookmarks: string
    views: string
    publishTime: string
    downloadCurrent: string
    downloadAll: string
    copyCurrentImage: string
    copyCurrentPage: string
    pageCount: string
    light: string
    dark: string
    placeholder: string
  }
> = {
  zh: {
    title: 'X To Everything',
    inputPanel: '左侧编辑区',
    previewPanel: '实时预览',
    username: '用户名',
    handle: '账号',
    ratio: '比例',
    theme: '主题',
    displayLanguage: '语言',
    avatar: '头像',
    media: '内嵌媒体图（可选）',
    content: '内容',
    contentZoom: '放大输入',
    contentCollapse: '收起',
    addImage: '添加图片',
    stats: '互动数据',
    comments: '留言',
    reposts: '转发',
    likes: '喜欢',
    bookmarks: '标签',
    views: '观看',
    publishTime: '发布时间',
    downloadCurrent: '下载当前页',
    downloadAll: '下载全部页',
    copyCurrentImage: '复制当前图片',
    copyCurrentPage: '复制当前页',
    pageCount: '分页数',
    light: '白天',
    dark: '黑夜',
    placeholder: '可直接粘贴内容。内容过长时会自动分页，尽量按完整句子切分。',
  },
  en: {
    title: 'X To Everything',
    inputPanel: 'Editor',
    previewPanel: 'Live Preview',
    username: 'Username',
    handle: 'Handle',
    ratio: 'Aspect',
    theme: 'Theme',
    displayLanguage: 'Display language',
    avatar: 'Avatar',
    media: 'Embedded media (optional)',
    content: 'Content',
    contentZoom: 'Zoom',
    contentCollapse: 'Collapse',
    addImage: 'Add image',
    stats: 'Engagement',
    comments: 'Comments',
    reposts: 'Reposts',
    likes: 'Likes',
    bookmarks: 'Bookmarks',
    views: 'Views',
    publishTime: 'Publish time',
    downloadCurrent: 'Download current',
    downloadAll: 'Download all',
    copyCurrentImage: 'Copy current image',
    copyCurrentPage: 'Copy current page',
    pageCount: 'Pages',
    light: 'Light',
    dark: 'Dark',
    placeholder:
      'Paste your text here. Long content is auto-splitted into multiple pages by complete sentences as much as possible.',
  },
}

function getCurrentDateTimeLocal() {
  const now = new Date()
  now.setSeconds(0, 0)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${date}T${hours}:${minutes}`
}

const CACHE_KEYS = {
  username: 'xe:username',
  handle: 'xe:handle',
  avatar: 'xe:avatar',
} as const

function loadCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveCache(key: string, value: string) {
  try {
    if (value === '') {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      localStorage.removeItem(key)
    }
  }
}

const CONTENT_WIDTH = PREVIEW_WIDTH - 28
const LINE_HEIGHT_PX = 21
const PARA_GAP_PX = 8

function getStringFullWidthLen(s: string) {
  let len = 0
  for (let i = 0; i < s.length; i++) {
    len += s.charCodeAt(i) > 255 ? 1 : 0.53
  }
  return len
}

const CARD_TOP = 52
const CARD_CONTENT_MARGIN = 14 + 16
const CARD_FOOTER = 74
const CARD_FIXED = CARD_TOP + CARD_CONTENT_MARGIN + CARD_FOOTER

/** 按内容区宽度等比计算图片完整显示高度，无上限。尺寸未知时用较小默认值，避免小图被误判后推到下一页 */
function getImageFullDisplayHeight(
  dims: { w: number; h: number } | undefined,
  containerWidth: number
): number {
  if (!dims || dims.w <= 0 || dims.h <= 0) return 100
  return Math.ceil((containerWidth * dims.h) / dims.w)
}

function getTextHeight(pageText: string, lang: Lang): number {
  const charsPerLine = Math.floor(CONTENT_WIDTH / 16)
  const paragraphs = pageText.split('\n').filter(Boolean)
  let totalLines = 0
  for (const p of paragraphs) {
    const fwLen = getStringFullWidthLen(p)
    totalLines += Math.max(1, Math.ceil(fwLen / charsPerLine))
  }
  return totalLines * LINE_HEIGHT_PX + Math.max(0, paragraphs.length - 1) * PARA_GAP_PX
}

const MEDIA_GAP_PX = 10

function estimateContentHeightFromItems(
  items: PageItem[],
  _allImages: string[],
  _imageDims: Record<number, { w: number; h: number }>,
  lang: Lang
): number {
  let contentHeight = 0
  let prevWasMedia = false
  for (const item of items) {
    if (item.type === 'text') {
      if (contentHeight > 0) contentHeight += PARA_GAP_PX
      contentHeight += getTextHeight(item.value, lang)
      prevWasMedia = false
    } else {
      if (prevWasMedia) contentHeight += MEDIA_GAP_PX
      contentHeight += item.clipHeight ?? item.fullHeight
      prevWasMedia = true
    }
  }
  return CARD_FIXED + contentHeight
}

type PageItem =
  | { type: 'text'; value: string }
  | { type: 'image'; url: string; fullHeight: number; clipTop?: number; clipHeight?: number }
type PageContent = { items: PageItem[] }

type ContentSegment = { type: 'text'; value: string } | { type: 'image'; index: number }

function parseContentWithMarkers(content: string, images: string[]): ContentSegment[] {
  const segments: ContentSegment[] = []
  let lastIndex = 0
  const re = /\[图片(\d+)\]/g
  let m = re.exec(content)
  while (m) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, m.index) })
    }
    const n = parseInt(m[1], 10) - 1
    if (n >= 0 && n < images.length) {
      segments.push({ type: 'image', index: n })
    }
    lastIndex = re.lastIndex
    m = re.exec(content)
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return segments
}

function paginateContentWithMarkers(
  content: string,
  images: string[],
  maxChars: number,
  maxHeight: number,
  lang: Lang,
  imageDims: Record<number, { w: number; h: number }>
): PageContent[] {
  const segments = parseContentWithMarkers(content, images)
  const pages: PageContent[] = []
  let currentItems: PageItem[] = []
  const contentMaxH = maxHeight - CARD_FIXED

  const flushPage = () => {
    if (currentItems.length > 0) {
      pages.push({ items: [...currentItems] })
      currentItems = []
    }
  }

  const est = (items: PageItem[]) =>
    estimateContentHeightFromItems(items, images, imageDims, lang)

  const addImageSlices = (imgUrl: string, fullHeight: number) => {
    let remaining = fullHeight
    let clipTop = 0
    while (remaining > 0) {
      const used = est(currentItems) - CARD_FIXED
      const available = contentMaxH - used
      if (available <= 0 && currentItems.length > 0) {
        flushPage()
        continue
      }
      const sliceHeight = Math.min(available > 0 ? available : contentMaxH, remaining)
      const isSlice = sliceHeight < fullHeight
      currentItems.push({
        type: 'image',
        url: imgUrl,
        fullHeight,
        ...(isSlice ? { clipTop, clipHeight: sliceHeight } : {}),
      })
      clipTop += sliceHeight
      remaining -= sliceHeight
      if (remaining > 0) flushPage()
    }
  }

  for (const seg of segments) {
    if (seg.type === 'text') {
      const units = getContentUnits(seg.value, maxChars)
      let currentText = ''
      for (const unit of units) {
        if (unit === '\n') {
          currentText += currentText && !currentText.endsWith('\n') ? '\n' : ''
          continue
        }
        if (!unit) continue
        const separator = currentText === '' || currentText.endsWith('\n') ? '' : ' '
        const candidate = `${currentText}${separator}${unit}`.trimStart()
        const lastIsText = currentItems.length > 0 && currentItems[currentItems.length - 1].type === 'text'
        const nextItems: PageItem[] = lastIsText
          ? [...currentItems.slice(0, -1), { type: 'text' as const, value: candidate }]
          : [...currentItems, { type: 'text' as const, value: candidate }]
        const h = est(nextItems)
        if (h > maxHeight && currentItems.length > 0) {
          flushPage()
          currentItems = [{ type: 'text' as const, value: unit }]
          currentText = unit
          if (est(currentItems) > maxHeight) {
            const subUnits = splitLongUnit(unit, Math.max(20, Math.floor(maxChars / 2)))
            currentItems = []
            for (const sub of subUnits) {
              const next = [...currentItems, { type: 'text' as const, value: sub }]
              if (est(next) > maxHeight && currentItems.length > 0) {
                flushPage()
                currentItems = [{ type: 'text' as const, value: sub }]
              } else {
                currentItems = next
              }
            }
            currentText = (currentItems[currentItems.length - 1] as { type: 'text'; value: string })?.value ?? ''
          }
        } else if (h > maxHeight && currentItems.length === 0) {
          const subUnits = splitLongUnit(unit, Math.max(20, Math.floor(maxChars / 2)))
          for (const sub of subUnits) {
            if (est([...currentItems, { type: 'text' as const, value: sub }]) > maxHeight && currentItems.length > 0) {
              flushPage()
              currentItems = [{ type: 'text' as const, value: sub }]
            } else {
              currentItems = [...currentItems, { type: 'text' as const, value: sub }]
            }
          }
          currentText = (currentItems[currentItems.length - 1] as { type: 'text'; value: string })?.value ?? ''
        } else {
          currentItems = nextItems
          currentText = candidate
        }
      }
    } else {
      const imgUrl = images[seg.index]
      const dims = imageDims[seg.index]
      const fullHeight = getImageFullDisplayHeight(dims, CONTENT_WIDTH)
      addImageSlices(imgUrl, fullHeight)
    }
  }
  flushPage()
  return pages.length > 0 ? pages : [{ items: [] }]
}

function estimateMaxChars(ratio: RatioKey, lang: Lang) {
  const { w, h } = RATIO_MAP[ratio]
  const height = Math.round((PREVIEW_WIDTH * h) / w)
  const fixedHeight = 52 + 30 + 74
  const contentHeight = height - fixedHeight
  const lines = Math.max(3, Math.floor(contentHeight / LINE_HEIGHT_PX))
  const charsPerLine = Math.floor(CONTENT_WIDTH / 16)
  return lines * charsPerLine
}

function splitLongUnit(unit: string, maxChars: number) {
  const result: string[] = []
  if (getStringFullWidthLen(unit) <= maxChars) return [unit]

  if (unit.includes(' ')) {
    const words = unit.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (getStringFullWidthLen(candidate) > maxChars) {
        if (current) result.push(current)
        if (getStringFullWidthLen(word) > maxChars) {
          for (let i = 0; i < word.length; i += maxChars) {
            result.push(word.slice(i, i + maxChars))
          }
          current = ''
        } else {
          current = word
        }
      } else {
        current = candidate
      }
    }
    if (current) result.push(current)
    return result
  }

  const punctRe = /[，。、；：！？!?\.\s]/
  let start = 0
  while (start < unit.length) {
    let end = start
    let fwLen = 0
    while (end < unit.length && fwLen < maxChars) {
      fwLen += unit.charCodeAt(end) > 255 ? 1 : 0.53
      if (fwLen > maxChars) break
      end++
    }
    if (end < unit.length) {
      const slice = unit.slice(start, end)
      let lastPunct = -1
      for (let i = slice.length - 1; i >= 0; i -= 1) {
        if (punctRe.test(slice[i])) {
          lastPunct = i
          break
        }
      }
      if (lastPunct > (end - start) * 0.4) {
        end = start + lastPunct + 1
      }
    }
    result.push(unit.slice(start, end))
    start = end
  }
  return result
}

function splitSentences(paragraph: string) {
  const chunks = paragraph.match(/[^。！？!?\.]+[。！？!?\.]*/g)
  return chunks?.map((item) => item.trim()).filter(Boolean) ?? [paragraph]
}

/** 生成内容单元流（用于按高度分页） */
function getContentUnits(text: string, maxCharsForLongUnit: number): (string | '\n')[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  const paragraphs = clean.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const units: (string | '\n')[] = []

  paragraphs.forEach((paragraph, idx) => {
    units.push(...splitSentences(paragraph))
    if (idx !== paragraphs.length - 1) units.push('\n')
  })

  const result: (string | '\n')[] = []
  for (const rawUnit of units) {
    if (rawUnit === '\n') {
      result.push('\n')
    } else {
      result.push(...splitLongUnit(rawUnit, maxCharsForLongUnit))
    }
  }
  return result
}

function formatViewsCount(lang: Lang, viewsValue: string) {
  const normalized = viewsValue.replace(/,/g, '').trim()
  const count = Number(normalized)
  if (Number.isNaN(count)) return viewsValue

  const toCompact = (value: number, divisor: number) => {
    const compact = value / divisor
    const fixed = compact >= 100 ? compact.toFixed(0) : compact.toFixed(1)
    return fixed.replace(/\.0$/, '')
  }

  if (lang === 'zh') {
    if (count >= 100000000) return `${toCompact(count, 100000000)}亿`
    if (count >= 10000) return `${toCompact(count, 10000)}万`
    return count.toLocaleString('zh-CN')
  }

  if (count >= 1000000000) return `${toCompact(count, 1000000000)}B`
  if (count >= 1000000) return `${toCompact(count, 1000000)}M`
  if (count >= 1000) return `${toCompact(count, 1000)}K`
  return count.toLocaleString('en-US')
}

function formatPublishTime(lang: Lang, value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const timePart = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)

  if (lang === 'zh') {
    const y = date.getFullYear()
    const m = date.getMonth() + 1
    const d = date.getDate()
    return `${timePart} · ${y}年${m}月${d}日`
  }

  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)

  return `${timePart} · ${datePart}`
}

function App() {
  const [displayLang, setDisplayLang] = useState<Lang>('zh')
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [ratio, setRatio] = useState<RatioKey>('3:4')
  const [username, setUsername] = useState(() => loadCache(CACHE_KEYS.username, 'XTEverything'))
  const [handle, setHandle] = useState(() => {
    const raw = loadCache(CACHE_KEYS.handle, '@XTEverything')
    return raw.startsWith('@') ? raw : `@${raw}`
  })
  const defaultContent = '可直接粘贴内容。内容过长时会自动分页，尽量按完整句子切分。'
  const [content, setContent] = useState(defaultContent)
  const [images, setImages] = useState<string[]>([])
  const [imageDims, setImageDims] = useState<Record<number, { w: number; h: number }>>({})
  const [comments, setComments] = useState('65')
  const [reposts, setReposts] = useState('59')
  const [likes, setLikes] = useState('710')
  const [bookmarks, setBookmarks] = useState('56')
  const [views, setViews] = useState('21000')
  const [publishTime, setPublishTime] = useState(getCurrentDateTimeLocal())
  const [avatar, setAvatar] = useState<string>(() => loadCache(CACHE_KEYS.avatar, ''))
  const [contentExpanded, setContentExpanded] = useState(false)
  const [selectedPage, setSelectedPage] = useState(0)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const contentRef = useRef<HTMLTextAreaElement | null>(null)
  const cursorPosRef = useRef<number | null>(null)
  const pasteBlockRef = useRef(false)
  const pendingPasteRef = useRef<{ value: string; pos: number } | null>(null)
  const [canvasScale, setCanvasScale] = useState(1)

  const saveCursorPos = () => {
    const ta = contentRef.current
    if (ta) cursorPosRef.current = ta.selectionStart
  }

  const t = TEXTS.zh
  const fieldClass =
    'w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#1d9bf0] focus:ring-4 focus:ring-[#1d9bf0]/15'
  const sectionClass =
    'rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

  const SectionHeader = ({
    icon,
    label,
  }: {
    icon: React.ReactNode
    label: string
  }) => (
    <h3 className="mb-4 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        {icon}
      </span>
      {label}
    </h3>
  )

  const maxChars = useMemo(() => estimateMaxChars(ratio, displayLang), [ratio, displayLang])
  const { w, h } = RATIO_MAP[ratio]
  const maxAspectHeight = Math.round((PREVIEW_WIDTH * h) / w)
  const pages = useMemo(
    () =>
      paginateContentWithMarkers(
        content,
        images,
        maxChars,
        maxAspectHeight,
        displayLang,
        imageDims
      ),
    [content, images, maxChars, maxAspectHeight, displayLang, imageDims]
  )
  const displayPublishTime = useMemo(
    () => formatPublishTime(displayLang, publishTime),
    [displayLang, publishTime]
  )
  const displayViewsCount = useMemo(() => formatViewsCount(displayLang, views), [displayLang, views])

  useEffect(() => {
    if (selectedPage > pages.length - 1) {
      setSelectedPage(0)
    }
  }, [pages.length, selectedPage])

  useEffect(() => {
    saveCache(CACHE_KEYS.username, username)
  }, [username])

  useEffect(() => {
    saveCache(CACHE_KEYS.handle, handle)
  }, [handle])

  useEffect(() => {
    saveCache(CACHE_KEYS.avatar, avatar)
  }, [avatar])

  useEffect(() => {
    if (images.length === 0) {
      setImageDims({})
      return
    }
    const mounted = { current: true }
    images.forEach((url, i) => {
      const img = new Image()
      img.onload = () => {
        if (!mounted.current) return
        const w = img.naturalWidth || 1
        const h = img.naturalHeight || 1
        setImageDims((prev) => {
          const cur = prev[i]
          if (cur?.w === w && cur?.h === h) return prev
          return { ...prev, [i]: { w, h } }
        })
      }
      img.onerror = () => {
        if (!mounted.current) return
        setImageDims((prev) => {
          if (prev[i]) return prev
          return { ...prev, [i]: { w: CONTENT_WIDTH, h: 100 } }
        })
      }
      img.src = url
    })
    return () => {
      mounted.current = false
    }
  }, [images])

  useEffect(() => {
    const re = /\[图片(\d+)\]/g
    const matches: { full: string; num: number; index: number }[] = []
    let m = re.exec(content)
    while (m) {
      matches.push({ full: m[0], num: parseInt(m[1], 10), index: m.index })
      m = re.exec(content)
    }
    const valid = matches.filter((x) => {
      const i = x.num - 1
      return i >= 0 && i < images.length
    })
    const newImages = valid.map((x) => images[x.num - 1])
    const needsSync =
      valid.length !== matches.length ||
      newImages.length !== images.length ||
      valid.some((x, i) => x.num !== i + 1)
    if (!needsSync) return
    const parts: string[] = []
    let lastEnd = 0
    let markerIndex = 0
    matches.forEach(({ full, num, index }) => {
      const i = num - 1
      if (i >= 0 && i < images.length) {
        parts.push(content.slice(lastEnd, index))
        parts.push(`[图片${markerIndex + 1}]`)
        markerIndex += 1
      }
      lastEnd = index + full.length
    })
    parts.push(content.slice(lastEnd))
    setImages(newImages)
    setContent(parts.join(''))
  }, [content])

  const cardHeights = useMemo(
    () =>
      pages.map((page) => {
        const contentH = estimateContentHeightFromItems(
          page.items,
          images,
          imageDims,
          displayLang
        )
        const minH = 180
        const targetH = Math.max(minH, contentH)
        return Math.min(targetH, maxAspectHeight)
      }),
    [pages, images, imageDims, displayLang, maxAspectHeight]
  )
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const currentH = cardHeights[selectedPage] ?? maxAspectHeight
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const h = cardHeights[selectedPage] ?? maxAspectHeight
      const scaleW = rect.width / PREVIEW_WIDTH
      const scaleH = rect.height / h
      setCanvasScale(Math.min(scaleW, scaleH, 1))
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    const scaleW = rect.width / PREVIEW_WIDTH
    const scaleH = rect.height / currentH
    setCanvasScale(Math.min(scaleW, scaleH, 1))
    return () => ro.disconnect()
  }, [cardHeights, selectedPage, maxAspectHeight])

  const onUploadAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    const inputEl = event.target
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const applyAvatar = (url: string) => {
        setAvatar(url)
        inputEl.value = ''
      }
      if (!dataUrl.startsWith('data:image')) {
        applyAvatar(dataUrl)
        return
      }
      const img = new Image()
      img.onload = () => {
        const max = 200
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w > max || h > max) {
          if (w > h) {
            h = Math.round((h * max) / w)
            w = max
          } else {
            w = Math.round((w * max) / h)
            h = max
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
          try {
            const compressed = canvas.toDataURL('image/jpeg', 0.88)
            applyAvatar(compressed)
          } catch {
            applyAvatar(dataUrl)
          }
        } else {
          applyAvatar(dataUrl)
        }
      }
      img.onerror = () => applyAvatar(dataUrl)
      img.src = dataUrl
    }
    reader.onerror = () => {
      inputEl.value = ''
    }
    reader.readAsDataURL(file)
  }

  const canAddImage = images.length < 4

  const captureCursorAndUpload = () => {
    if (!canAddImage) return
    const ta = contentRef.current
    if (ta) {
      cursorPosRef.current = ta.selectionStart
    }
    fileInputRef.current?.click()
  }

  const onUploadMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !canAddImage) return
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      const pos = cursorPosRef.current ?? content.length
      const marker = `[图片${images.length + 1}]`
      setContent((prev) => prev.slice(0, pos) + marker + prev.slice(pos))
      setImages((prev) => [...prev, value])
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const handlePasteContent = (e: React.ClipboardEvent) => {
    if (pasteBlockRef.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const ta = contentRef.current
    if (!ta || !canAddImage) return
    if (e.target !== ta) return
    const dt = e.clipboardData
    if (!dt) return
    const file =
      dt.files?.length && dt.files[0].type.startsWith('image/')
        ? dt.files[0]
        : (() => {
            if (!dt.items?.length) return null
            for (let i = 0; i < dt.items.length; i++) {
              if (dt.items[i].type.startsWith('image/')) {
                return dt.items[i].getAsFile()
              }
            }
            return null
          })()
    if (!file) return
    pasteBlockRef.current = true
    e.preventDefault()
    e.stopPropagation()
    const pos = ta.selectionStart
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      pendingPasteRef.current = { value, pos }
      setImages((prev) => {
        const pending = pendingPasteRef.current
        if (!pending) return prev
        pendingPasteRef.current = null
        const marker = `[图片${prev.length + 1}]`
        setContent((c) => c.slice(0, pending.pos) + marker + c.slice(pending.pos))
        return [...prev, pending.value]
      })
      setTimeout(() => {
        pasteBlockRef.current = false
      }, 600)
    }
    reader.onerror = () => {
      pasteBlockRef.current = false
    }
    reader.readAsDataURL(file)
  }

  const saveCard = async (index: number, userName?: string, userHandle?: string) => {
    const node = cardRefs.current[index]
    if (!node) return
    const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true })
    const link = document.createElement('a')
    const u = (userName ?? username) || (userHandle ?? handle).replace('@', '') || 'tweet'
    const safeName = u.replace(/[/\\:*?"<>|]/g, '_').trim() || 'tweet'
    link.download = `XTE-${safeName}-${index + 1}.png`
    link.href = dataUrl
    link.click()
  }

  const downloadAll = async () => {
    for (let i = 0; i < pages.length; i += 1) {
      await saveCard(i, username, handle)
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }

  const copyCurrentImage = async () => {
    const page = pages[selectedPage]
    if (!page) return
    const imageItems = page.items.filter((i): i is { type: 'image'; url: string; fullHeight: number; clipTop?: number; clipHeight?: number } => i.type === 'image')
    if (imageItems.length !== 1) return
    const item = imageItems[0]
    try {
      let blob: Blob
      if (item.clipHeight != null && item.clipTop != null) {
        blob = await new Promise<Blob>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            const natW = img.naturalWidth
            const natH = img.naturalHeight
            const fullH = item.fullHeight
            const sy = (item.clipTop! / fullH) * natH
            const sh = (item.clipHeight! / fullH) * natH
            const canvas = document.createElement('canvas')
            canvas.width = CONTENT_WIDTH
            canvas.height = item.clipHeight!
            const ctx = canvas.getContext('2d')
            if (!ctx) return reject(new Error('No context'))
            ctx.drawImage(img, 0, sy, natW, sh, 0, 0, canvas.width, canvas.height)
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
          }
          img.onerror = reject
          img.src = item.url
        })
      } else {
        const res = await fetch(item.url)
        blob = await res.blob()
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    } catch {
      // Clipboard API may fail in some contexts
    }
  }

  const currentPageImageCount = pages[selectedPage]?.items.filter((i) => i.type === 'image').length ?? 0

  const copyCurrentPage = async () => {
    const node = cardRefs.current[selectedPage]
    if (!node) return
    try {
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    } catch {
      // Clipboard API may fail
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-0 w-full max-w-[1540px] flex-1 flex-col overflow-hidden px-4 py-3 lg:px-8 lg:py-4">
        <header className="mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-1.5 font-nunito text-2xl font-extrabold tracking-tight">
            <img src="/xe-icon.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="bg-gradient-to-r from-slate-600 to-slate-500 bg-clip-text text-transparent">
              X To Everything
            </span>
          </h1>
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/WiseInvest513"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="X (Twitter) @WiseInvest513"
            >
              <svg viewBox="0 0 1200 1227" className="h-5 w-5" fill="currentColor">
                <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
              </svg>
            </a>
            <a
              href="https://www.wise-invest.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Wise Invest"
            >
              <img
                src="https://www.wise-invest.org/favicon.ico"
                alt="Wise Invest"
                className="h-5 w-5"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                  target.nextElementSibling?.classList.remove('hidden')
                }}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hidden h-5 w-5 text-slate-600">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </a>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(360px,35%)_minmax(0,65%)]">
          <section
            className={`min-h-0 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_6px_-1px_rgba(15,23,42,0.05),0_2px_4px_-2px_rgba(15,23,42,0.05)] ${
              contentExpanded ? 'flex flex-col overflow-hidden' : 'overflow-auto'
            }`}
            onPasteCapture={handlePasteContent}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onUploadMedia}
              className="hidden"
            />
            {contentExpanded ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-3 flex flex-shrink-0 items-center justify-between">
                  <h3 className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </span>
                    内容编辑
                  </h3>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={() => setContentExpanded(false)}
                  >
                    {t.contentCollapse}
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <textarea
                    ref={contentRef}
                    className={`${fieldClass} min-h-0 flex-1 resize-none text-base`}
                    value={content}
                    onChange={(e) => { setContent(e.target.value); saveCursorPos() }}
                    onSelect={saveCursorPos}
                    onBlur={saveCursorPos}
                    placeholder={t.placeholder}
                  />
                  {canAddImage && (
                    <button
                      type="button"
                      className="flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 transition hover:border-[#1d9bf0]/50 hover:text-[#1d9bf0]"
                      onMouseDown={captureCursorAndUpload}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      {t.addImage}（在光标处插入）
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
            <div className={sectionClass}>
              <SectionHeader
                icon={
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                }
                label="基础信息"
              />
              <div className="grid grid-cols-1 gap-y-3 md:grid-cols-3 md:gap-x-3">
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.username}</span>
                  <input
                    className={`${fieldClass} h-10`}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.handle}</span>
                  <div className="flex h-10">
                    <span className="inline-flex shrink-0 items-center rounded-l-xl border border-r-0 border-slate-200/80 bg-slate-100 px-3 text-slate-600">
                      @
                    </span>
                    <input
                      className={`${fieldClass} h-full rounded-l-none border-l-0`}
                      value={handle.startsWith('@') ? handle.slice(1) : handle}
                      onChange={(e) => setHandle('@' + e.target.value.replace(/@/g, ''))}
                      placeholder="XTEverything"
                    />
                  </div>
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="flex min-h-[1.25rem] items-center gap-2">
                    {t.avatar}
                    {avatar ? (
                      <span className="text-[10px] font-normal text-emerald-600">已上传</span>
                    ) : null}
                  </span>
                  <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-dashed border-slate-200/80 bg-white">
                    <input
                      className="h-full min-w-0 flex-1 cursor-pointer border-0 bg-transparent file:mr-3 file:h-full file:flex file:items-center file:rounded-l-[10px] file:border-0 file:bg-[#1d9bf0]/10 file:px-2.5 file:py-0 file:text-xs file:font-semibold file:text-[#1d9bf0]"
                      type="file"
                      accept="image/*"
                      onChange={onUploadAvatar}
                    />
                  </div>
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-y-3 md:grid-cols-3 md:gap-x-3">
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.ratio}</span>
                  <select className={`${fieldClass} h-10`} value={ratio} onChange={(e) => setRatio(e.target.value as RatioKey)}>
                    <option value="3:4">3:4</option>
                    <option value="9:16">9:16</option>
                  </select>
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.theme}</span>
                  <select className={`${fieldClass} h-10`} value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
                    <option value="light">{t.light}</option>
                    <option value="dark">{t.dark}</option>
                  </select>
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.displayLanguage}</span>
                  <select className={`${fieldClass} h-10`} value={displayLang} onChange={(e) => setDisplayLang(e.target.value as Lang)}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
            </div>

            <div className={`${sectionClass} mt-4`}>
              <div className="mb-4 flex items-center justify-between">
                <SectionHeader
                  icon={
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  }
                  label="内容编辑"
                />
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  onClick={() => setContentExpanded(true)}
                >
                  {t.contentZoom}
                </button>
              </div>
              <div className="space-y-2">
                <textarea
                  ref={contentRef}
                  className={`${fieldClass} min-h-[140px] resize-y`}
                  value={content}
                  onChange={(e) => { setContent(e.target.value); saveCursorPos() }}
                  onSelect={saveCursorPos}
                  onBlur={saveCursorPos}
                  onPaste={handlePasteContent}
                  placeholder={t.placeholder}
                />
                {canAddImage && (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 transition hover:border-[#1d9bf0]/50 hover:text-[#1d9bf0]"
                    onMouseDown={captureCursorAndUpload}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    {t.addImage}（在光标处插入）
                  </button>
                )}
              </div>
            </div>

            <div className={`${sectionClass} mt-4`}>
              <SectionHeader
                icon={
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                }
                label={t.stats}
              />
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 xl:grid-cols-5">
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.comments}</span>
                  <input className={`${fieldClass} h-10`} value={comments} onChange={(e) => setComments(e.target.value)} />
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.reposts}</span>
                  <input className={`${fieldClass} h-10`} value={reposts} onChange={(e) => setReposts(e.target.value)} />
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.likes}</span>
                  <input className={`${fieldClass} h-10`} value={likes} onChange={(e) => setLikes(e.target.value)} />
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.bookmarks}</span>
                  <input className={`${fieldClass} h-10`} value={bookmarks} onChange={(e) => setBookmarks(e.target.value)} />
                </label>
                <label className="grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                  <span className="min-h-[1.25rem]">{t.views}</span>
                  <input className={`${fieldClass} h-10`} type="number" value={views} onChange={(e) => setViews(e.target.value)} />
                </label>
              </div>
              <label className="mt-4 grid grid-cols-1 gap-1.5 text-xs font-medium text-slate-600">
                <span className="min-h-[1.25rem]">{t.publishTime}</span>
                <input
                  className={`${fieldClass} h-10`}
                  type="datetime-local"
                  value={publishTime}
                  onChange={(e) => setPublishTime(e.target.value)}
                />
              </label>
            </div>
              </>
            )}
          </section>

          <section className="grid min-h-0 grid-rows-[auto_1fr_auto_auto] overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_6px_-1px_rgba(15,23,42,0.05),0_2px_4px_-2px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="9" y1="21" x2="9" y2="9" />
                    </svg>
                  </span>
                  {t.previewPanel}
                </h2>
                <p className="mt-1.5 text-xs text-slate-500">{t.pageCount}: {pages.length}</p>
              </div>
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium">Canvas</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium">{ratio}</span>
              </div>
            </div>

            <div className="relative min-h-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-[#f3f4f6] p-4 shadow-inner">
              <div className="absolute inset-3 rounded-xl bg-[repeating-linear-gradient(0deg,transparent,transparent_19px,rgba(148,163,184,0.15)_19px,rgba(148,163,184,0.15)_20px),repeating-linear-gradient(90deg,transparent,transparent_19px,rgba(148,163,184,0.15)_19px,rgba(148,163,184,0.15)_20px)] pointer-events-none" aria-hidden />
              <div
                ref={canvasRef}
                className="relative flex h-full min-h-0 items-center justify-center rounded-xl"
              >
                {pages.map((page, index) => {
                  const pageHeight = cardHeights[index] ?? maxAspectHeight
                  return (
                  <div
                    key={`page-${index}`}
                    style={{
                      display: selectedPage === index ? 'block' : 'none',
                      width: PREVIEW_WIDTH * canvasScale,
                      height: pageHeight * canvasScale,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        transform: `scale(${canvasScale})`,
                        transformOrigin: '0 0',
                        width: PREVIEW_WIDTH,
                        height: pageHeight,
                      }}
                    >
                      <article
                        className={`tweet-card ${theme} ${selectedPage === index ? 'active' : ''} rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]`}
                        style={{ width: PREVIEW_WIDTH, height: pageHeight }}
                        ref={(node) => {
                          cardRefs.current[index] = node
                        }}
                      >
                <div className="tweet-top">
                  <div className="user-main">
                    <div className="avatar-wrap">
                      {avatar ? (
                        <img src={avatar} className="avatar" alt="avatar" />
                      ) : (
                        <div className="avatar initials">{username.slice(0, 2).toUpperCase()}</div>
                      )}
                    </div>
                    <div className="identity">
                      <div className="name-row">
                        <strong>{username || 'User'}</strong>
                        <span className="verified-badge" aria-label="Verified account">
                          <svg viewBox="0 0 22 22" aria-hidden="true">
                            <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
                          </svg>
                        </span>
                      </div>
                      <span className="handle">{handle || '@user'}</span>
                    </div>
                  </div>
                  <div className="top-actions">
                    <button className="grok-btn" type="button" aria-label="Grok actions">
                      <svg viewBox="0 0 33 32" aria-hidden="true">
                        <path d="M12.745 20.54l10.97-8.19c.539-.4 1.307-.244 1.564.38 1.349 3.288.746 7.241-1.938 9.955-2.683 2.714-6.417 3.31-9.83 1.954l-3.728 1.745c5.347 3.697 11.84 2.782 15.898-1.324 3.219-3.255 4.216-7.692 3.284-11.693l.008.009c-1.351-5.878.332-8.227 3.782-13.031L33 0l-4.54 4.59v-.014L12.743 20.544m-2.263 1.987c-3.837-3.707-3.175-9.446.1-12.755 2.42-2.449 6.388-3.448 9.852-1.979l3.72-1.737c-.67-.49-1.53-1.017-2.515-1.387-4.455-1.854-9.789-.931-13.41 2.728-3.483 3.523-4.579 8.94-2.697 13.561 1.405 3.454-.899 5.898-3.22 8.364C1.49 30.2.666 31.074 0 32l10.478-9.466" />
                      </svg>
                    </button>
                    <button className="more-btn" type="button" aria-label="more">
                      <svg viewBox="0 0 24 24">
                        <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  className="tweet-content"
                  dir="auto"
                  lang={displayLang === 'zh' ? 'zh' : 'en'}
                >
                  {page.items.map((item, idx) =>
                    item.type === 'text' ? (
                      <Fragment key={`item-${idx}`}>
                        {item.value.split('\n').map((line, lineIdx) => (
                          <p key={lineIdx}>{line}</p>
                        ))}
                      </Fragment>
                    ) : (() => {
                      const { clipTop, clipHeight, fullHeight } = item
                      const isSlice = clipHeight != null && clipHeight < fullHeight
                      return (
                        <div
                          key={`item-${idx}`}
                          className="media-card"
                          style={{
                            height: isSlice ? clipHeight : undefined,
                            minHeight: isSlice ? undefined : 120,
                          }}
                        >
                          {isSlice ? (
                            <div
                              style={{
                                height: fullHeight,
                                marginTop: -clipTop!,
                              }}
                            >
                              <img
                                src={item.url}
                                alt=""
                                style={{
                                  width: '100%',
                                  height: fullHeight,
                                  objectFit: 'contain',
                                  display: 'block',
                                }}
                              />
                            </div>
                          ) : (
                            <img
                              src={item.url}
                              alt=""
                              style={{
                                width: '100%',
                                height: fullHeight,
                                objectFit: 'contain',
                                display: 'block',
                              }}
                            />
                          )}
                        </div>
                      )
                    })()
                  )}
                </div>

                <footer className="tweet-footer">
                  <div className="meta-line">
                    <span>{displayPublishTime}</span>
                    <span className="dot">·</span>
                    <span className="views-line">
                      <strong>{displayViewsCount}</strong>
                      <span>{displayLang === 'en' ? 'Views' : '次观看'}</span>
                    </span>
                  </div>
                  <div className="action-row">
                    <span className="action-item">
                      <ActionIcon kind="reply" path="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
                      <em>{comments}</em>
                    </span>
                    <span className="action-item">
                      <ActionIcon
                        kind="repost"
                        path="M23.77 15.67c-.292-.293-.767-.293-1.06 0l-2.22 2.22V7.65c0-2.068-1.683-3.75-3.75-3.75h-5.85c-.414 0-.75.336-.75.75s.336.75.75.75h5.85c1.24 0 2.25 1.01 2.25 2.25v10.24l-2.22-2.22c-.293-.293-.768-.293-1.06 0s-.294.768 0 1.06l3.5 3.5c.145.147.337.22.53.22s.383-.072.53-.22l3.5-3.5c.294-.292.294-.767 0-1.06zm-10.66 3.28H7.26c-1.24 0-2.25-1.01-2.25-2.25V6.46l2.22 2.22c.148.147.34.22.532.22s.384-.073.53-.22c.293-.293.293-.768 0-1.06l-3.5-3.5c-.293-.294-.768-.294-1.06 0l-3.5 3.5c-.294.292-.294.767 0 1.06s.767.293 1.06 0l2.22-2.22V16.7c0 2.068 1.683 3.75 3.75 3.75h5.85c.414 0 .75-.336.75-.75s-.337-.75-.75-.75z"
                      />
                      <em>{reposts}</em>
                    </span>
                    <span className="action-item">
                      <ActionIcon kind="like" path="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
                      <em>{likes}</em>
                    </span>
                    <span className="action-item">
                      <ActionIcon kind="bookmark" path="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" />
                      <em>{bookmarks}</em>
                    </span>
                    <span className="action-item">
                      <ActionIcon kind="share" path="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
                    </span>
                  </div>
                </footer>
                      </article>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-3 flex flex-shrink-0 flex-wrap gap-2">
              {pages.map((_, idx) => (
                <button
                  key={`thumb-${idx}`}
                  type="button"
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    selectedPage === idx
                      ? 'border-slate-600 bg-slate-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                  onClick={() => setSelectedPage(idx)}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={copyCurrentPage}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-slate-200/80"
              >
                {t.copyCurrentPage}
              </button>
              {currentPageImageCount === 1 && (
                <button
                  type="button"
                  onClick={copyCurrentImage}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-slate-200/80"
                >
                  {t.copyCurrentImage}
                </button>
              )}
              <button
                type="button"
                onClick={() => saveCard(selectedPage, username, handle)}
                className="rounded-xl bg-slate-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-slate-300/50"
              >
                {t.downloadCurrent}
              </button>
              <button
                type="button"
                onClick={downloadAll}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-slate-200/80"
              >
                {t.downloadAll}
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
