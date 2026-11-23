import { afterEach, describe, expect, it } from 'vitest'
import { lang, pickSystemLanguage, pluralCategory, t, useLangStore } from './index'

describe('t()', () => {
  afterEach(() => useLangStore.setState({ id: 'source', strings: {}, locale: 'en', images: {} }))

  it('fills in {placeholders}, leaving unknown ones', () => {
    expect(t('Hi {name}, {missing}!', { name: 'Anna' })).toBe('Hi Anna, {missing}!')
  })

  it('translates with the current table, falling back to the source text', () => {
    useLangStore.setState({ id: 'pl' as never, strings: { 'Health {value}': 'Zdrowie {value}' } })
    expect(t('Health {value}', { value: 5 })).toBe('Zdrowie 5')
    expect(t('Not translated')).toBe('Not translated')
    expect(lang.missing('pl' as never)).toContain(`    "Not translated": '',`)
  })

  it("picks plural forms by {count} with the language's own rules", () => {
    const apples = '{count} apples'
    useLangStore.setState({
      id: 'pl' as never,
      locale: 'pl',
      strings: {
        [apples]: {
          one: '{count} jabłko',
          few: '{count} jabłka',
          many: '{count} jabłek',
          other: '{count} jabłka',
        },
      },
    })
    expect(t(apples, { count: 1 })).toBe('1 jabłko')
    expect(t(apples, { count: 3 })).toBe('3 jabłka')
    expect(t(apples, { count: 5 })).toBe('5 jabłek')
    // No count given: the fallback form.
    expect(t(apples)).toBe('{count} jabłka')
  })

  it('the source language can list plural forms too', () => {
    useLangStore.setState({
      id: 'source',
      locale: 'en',
      strings: { '{count} apples': { one: '{count} apple', other: '{count} apples' } },
    })
    expect(t('{count} apples', { count: 1 })).toBe('1 apple')
    expect(t('{count} apples', { count: 2 })).toBe('2 apples')
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('not a language', 1)).toBe('other')
  })

  it('the source language can reword text (the engine own too); translations keep the original key', () => {
    useLangStore.setState({
      id: 'source',
      locale: 'en',
      strings: { 'Quest complete: {title}': 'Mission done: {title}' },
    })
    expect(t('Quest complete: {title}', { title: 'Wolves' })).toBe('Mission done: Wolves')
    useLangStore.setState({
      id: 'pl' as never,
      strings: { 'Quest complete: {title}': 'Zadanie wykonane: {title}' },
    })
    expect(t('Quest complete: {title}', { title: 'Wilki' })).toBe('Zadanie wykonane: Wilki')
  })

  it("swaps pictures for the language's own", () => {
    useLangStore.setState({ images: { '/sign.png': '/sign.pl.png' } })
    expect(lang.image('/sign.png')).toBe('/sign.pl.png')
    expect(lang.image('/other.png')).toBe('/other.png')
  })

  it('loads a language from src/content/lang', async () => {
    await lang.set('pl' as never)
    expect(lang.current()).toBe('pl')
    expect(t('Inventory')).toBe('Ekwipunek')
    await lang.set('source')
    expect(t('Inventory')).toBe('Inventory')
  })
})

describe('first start: the device language', () => {
  const ids = ['ja', 'pl', 'pt_br']
  it("takes the first of the device's languages that the game has", () => {
    expect(pickSystemLanguage(['ja-JP', 'en-US'], ids)).toBe('ja')
    expect(pickSystemLanguage(['de-DE', 'pl'], ids)).toBe('pl') // no German: the next one
    expect(pickSystemLanguage(['pt-BR'], ids)).toBe('pt_br') // an exact folder match first
  })

  it('English on the device (any region), or nothing the game has: the source language', () => {
    expect(pickSystemLanguage(['en-GB', 'ja'], ids)).toBe('source')
    expect(pickSystemLanguage(['de-DE', 'fr'], ids)).toBe('source')
    expect(pickSystemLanguage([], ids)).toBe('source')
  })
})
