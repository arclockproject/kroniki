// Engine guide: builds the side navigation (pages + this page's sections), the theme toggle,
// heading anchors, previous/next links, search over all pages and coloured code blocks. The search
// index and the coloured code come from `pnpm guide` (search-index.gen.js, code.gen.js).
// Plain script, no build step, works from file://. Pages may sit in sub-folders (world/maps.html,
// story/events/stage.html): every link is built from the guide's root, found from this script's own
// address (docs/assets/docs.js), so a page at any depth links the same way.

/**
 * Every page, in reading order, as a path from docs/. Add new pages here (and run `pnpm guide`).
 * `group` = the folder's heading in the nav; `sub` = a level-3 folder's heading (indented).
 */
const PAGES = [
  { file: 'index.html', title: 'Start here', group: 'Guide' },
  { file: 'recipes.html', title: 'Recipes', group: 'Guide' },
  { file: 'world/maps.html', title: 'Maps & the world', group: 'World' },
  { file: 'world/characters.html', title: 'Characters & NPCs', group: 'World' },
  { file: 'world/art.html', title: 'Art: sprites & portraits', group: 'World' },
  { file: 'story/events/scripts.html', title: 'Writing a scene', group: 'Story', sub: 'Events' },
  { file: 'story/events/stage.html', title: 'The stage', group: 'Story', sub: 'Events' },
  { file: 'story/events/flow.html', title: 'Flow, saves & endings', group: 'Story', sub: 'Events' },
  { file: 'story/vn.html', title: 'Dialogue scripts (.vn)', group: 'Story' },
  { file: 'story/routes.html', title: 'Routes & flowchart (VN mode)', group: 'Story' },
  { file: 'gameplay/items.html', title: 'Flags, items & money', group: 'Gameplay' },
  { file: 'gameplay/progress.html', title: 'Quests, timers & journal', group: 'Gameplay' },
  { file: 'gameplay/battles.html', title: 'Party & battles', group: 'Gameplay' },
  { file: 'gameplay/extras.html', title: 'Endings & extras', group: 'Gameplay' },
  { file: 'interface/screens.html', title: 'Screens & windows', group: 'Interface' },
  { file: 'interface/input.html', title: 'Input', group: 'Interface' },
  { file: 'interface/look.html', title: "The game's look", group: 'Interface' },
  { file: 'interface/settings.html', title: 'Settings & screen', group: 'Interface' },
  { file: 'interface/translations.html', title: 'Translations', group: 'Interface' },
  { file: 'systems/audio.html', title: 'Audio', group: 'Systems' },
  { file: 'systems/saves.html', title: 'Saves & settings', group: 'Systems' },
  { file: 'systems/variants.html', title: 'Content variants', group: 'Systems' },
  { file: 'systems/tools.html', title: 'Tools, tests & building', group: 'Systems' },
]

/** docs/ as a URL (this script is docs/assets/docs.js). */
const ROOT = new URL('..', document.currentScript.src)
/** A page's path from docs/ -> a link that works from any page. */
const link = (file) => new URL(file, ROOT).href
/** This page as a path from docs/ ('story/events/stage.html'). */
const here = (() => {
  const path = decodeURI(location.pathname).slice(decodeURI(ROOT.pathname).length)
  return !path || path.endsWith('/') ? `index.html` : path
})()
const root = document.documentElement

// ---------------------------------------------------------------- theme

function toggleTheme() {
  const light = root.dataset.theme !== 'light'
  if (light) root.dataset.theme = 'light'
  else delete root.dataset.theme
  try {
    localStorage.setItem('docs-theme', light ? 'light' : 'dark')
  } catch {}
}

// ---------------------------------------------------------------- headings

/** Gives every h2/h3 an id (if missing) and a "#" link. */
function anchorHeadings() {
  const used = new Set()
  for (const h of document.querySelectorAll('main h2, main h3')) {
    h.dataset.title = h.textContent.trim()
    if (!h.id) {
      let id = h.textContent
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      while (used.has(id) || document.getElementById(id)) id += '-'
      h.id = id
    }
    used.add(h.id)
    const a = document.createElement('a')
    a.href = `#${h.id}`
    a.className = 'anchor'
    a.textContent = '#'
    a.setAttribute('aria-label', 'Link to this section')
    h.append(a)
  }
}

// ---------------------------------------------------------------- navigation

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function buildNav() {
  const nav = document.getElementById('nav')
  if (!nav) return
  const theme = el('button', { className: 'theme', type: 'button', textContent: 'theme' })
  theme.addEventListener('click', toggleTheme)
  nav.append(
    el('div', { className: 'title' }, [
      el('a', { href: link('index.html'), textContent: 'Kroniki Engine', className: 'home-link' }),
      theme,
    ]),
    buildSearch(),
  )
  let group = ''
  let sub = ''
  for (const page of PAGES) {
    if (page.group !== group) {
      group = page.group
      sub = ''
      nav.append(el('div', { className: 'group', textContent: group }))
    }
    // A level-3 folder: its own small heading, its pages indented under it.
    if ((page.sub ?? '') !== sub) {
      sub = page.sub ?? ''
      if (sub) nav.append(el('div', { className: 'sub', textContent: sub }))
    }
    const current = page.file === here
    const classes = [current ? 'current' : '', page.sub ? 'in-sub' : ''].filter(Boolean)
    nav.append(
      el('a', { href: link(page.file), textContent: page.title, className: classes.join(' ') }),
    )
    if (current) {
      const toc = el('div', { className: page.sub ? 'toc toc-sub' : 'toc' })
      for (const h of document.querySelectorAll('main h2')) {
        toc.append(el('a', { href: `#${h.id}`, textContent: h.dataset.title }))
      }
      nav.append(toc)
    }
  }
}

function buildPager() {
  const main = document.querySelector('main')
  const index = PAGES.findIndex((p) => p.file === here)
  if (!main || index < 0) return
  const prev = PAGES[index - 1]
  const next = PAGES[index + 1]
  main.append(
    el('div', { className: 'pager' }, [
      prev ? el('a', { href: link(prev.file), textContent: `← ${prev.title}` }) : el('span'),
      next ? el('a', { href: link(next.file), textContent: `${next.title} →` }) : el('span'),
    ]),
  )
}

// ---------------------------------------------------------------- search

function buildSearch() {
  const input = el('input', {
    type: 'search',
    placeholder: 'Search the guide  ( / )',
    'aria-label': 'Search the guide',
  })
  const results = el('div', { className: 'results', hidden: true })
  let active = 0
  let hits = []

  const render = () => {
    results.replaceChildren(
      ...hits.map((hit, i) =>
        el('a', { href: `${link(hit.page)}#${hit.id}`, className: i === active ? 'active' : '' }, [
          hit.title,
          el('small', { textContent: hit.where }),
        ]),
      ),
    )
    results.hidden = hits.length === 0
  }

  input.addEventListener('input', () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean)
    const index = window.DOCS_INDEX || []
    hits = words.length
      ? index
          .map((entry) => {
            const title = entry.title.toLowerCase()
            const text = entry.text.toLowerCase()
            let score = 0
            for (const w of words) {
              if (title.includes(w)) score += 3
              else if (text.includes(w)) score += 1
              else return null
            }
            const page = PAGES.find((p) => p.file === entry.page)
            return { ...entry, score, where: page ? page.title : entry.page }
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
      : []
    active = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(0, Math.min(hits.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))
      render()
    } else if (e.key === 'Enter' && hits[active]) {
      location.href = `${link(hits[active].page)}#${hits[active].id}`
    } else if (e.key === 'Escape') {
      input.value = ''
      hits = []
      render()
    }
  })
  input.addEventListener('blur', () => {
    setTimeout(() => {
      results.hidden = true
    }, 150)
  })
  input.addEventListener('focus', () => {
    results.hidden = hits.length === 0
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault()
      input.focus()
    }
  })
  return el('div', { className: 'search' }, [input, results])
}

// ---------------------------------------------------------------- code colours

/** Same hash as scripts/docs.ts. */
function codeKey(text) {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  return `${hash.toString(36)}-${text.length}`
}

/** Swaps each code block for its coloured version (if `pnpm guide` has seen this exact text). */
function colourCode() {
  const coloured = window.DOCS_CODE || {}
  for (const code of document.querySelectorAll('pre > code')) {
    const html = coloured[codeKey(code.textContent)]
    if (html) {
      code.innerHTML = html
      code.classList.add('coloured')
    }
  }
}

colourCode()
anchorHeadings()
buildNav()
buildPager()
