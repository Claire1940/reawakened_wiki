import { getAllContent, CONTENT_TYPES } from '@/lib/content'
import type { Language, ContentItem } from '@/lib/content'

export interface ArticleLink {
  url: string
  title: string
}

export type ModuleLinkMap = Record<string, ArticleLink | null>

interface ArticleWithType extends ContentItem {
  contentType: string
}

// Module sub-field mapping: moduleKey -> { field, nameKey }
const MODULE_FIELDS: Record<string, { field: string; nameKey: string }> = {
  reawakendBeginnerGuide: { field: 'steps', nameKey: 'title' },
  reawakendCodesGuide: { field: 'cards', nameKey: 'name' },
  reawakendClassesGuide: { field: 'items', nameKey: 'name' },
  reawakendTraitsGuide: { field: 'solutions', nameKey: 'name' },
  reawakendPathsGuide: { field: 'cards', nameKey: 'name' },
  reawakendGatesGuide: { field: 'regions', nameKey: 'name' },
  reawakendBossesGuide: { field: 'creatures', nameKey: 'name' },
  reawakendGearGuide: { field: 'items', nameKey: 'name' },
  reawakendLevelingGuide: { field: 'sections', nameKey: 'name' },
  reawakendBestBuilds: { field: 'priorities', nameKey: 'name' },
  reawakendHunterRanks: { field: 'groups', nameKey: 'name' },
  reawakendGameFAQ: { field: 'faqs', nameKey: 'question' },
  reawakendBuildTips: { field: 'faqs', nameKey: 'question' },
  reawakendCommunity: { field: 'settings', nameKey: 'name' },
  reawakendUpdateLog: { field: 'entries', nameKey: 'title' },
  reawakendEarlyTips: { field: 'steps', nameKey: 'title' },
  reawakendFishingGuide: { field: 'steps', nameKey: 'title' },
  reawakendSideQuestsGuide: { field: 'items', nameKey: 'title' },
  reawakendWeaponsGuide: { field: 'items', nameKey: 'weapon_class' },
  reawakendSpellsGuide: { field: 'categories', nameKey: 'title' },
  reawakendGemsGuide: { field: 'items', nameKey: 'entry' },
  reawakendFameGuide: { field: 'items', nameKey: 'title' },
  reawakendEndgameGuide: { field: 'items', nameKey: 'headline' },
  reawakendCharacterImportGuide: { field: 'items', nameKey: 'label' },
  reawakendHeirloomGuide: { field: 'items', nameKey: 'label' },
  reawakendAchievementsGuide: { field: 'categories', nameKey: 'section' },
  reawakendCheatsGuide: { field: 'cards', nameKey: 'cardTitle' },
  reawakendSteamDeckGuide: { field: 'sections', nameKey: 'section' },
}

// Extra semantic keywords per module to boost matching for h2 titles
// These supplement the module title text when matching against articles
const MODULE_EXTRA_KEYWORDS: Record<string, string[]> = {
  reawakendBeginnerGuide: ['guide', 'beginner', 'hunter', 'gate', 'progression'],
  reawakendCodesGuide: ['codes', 'redeem', 'xp boost', 'cosmetic'],
  reawakendClassesGuide: ['class', 'warrior', 'mage', 'rogue', 'combat'],
  reawakendTraitsGuide: ['traits', 'passive', 'build', 'stack'],
  reawakendPathsGuide: ['paths', 'progression', 'stat', 'growth'],
  reawakendGatesGuide: ['gates', 'dungeon', 'rank', 'enemy'],
  reawakendBossesGuide: ['boss', 'encounter', 'combat', 'gate'],
  reawakendGearGuide: ['gear', 'equipment', 'upgrade', 'item'],
  reawakendLevelingGuide: ['leveling', 'xp', 'farm', 'rank'],
  reawakendBestBuilds: ['builds', 'class', 'traits', 'path', 'gear'],
  reawakendHunterRanks: ['ranks', 'hunter', 'tier', 'unlock'],
  reawakendGameFAQ: ['faq', 'gameplay', 'multiplayer', 'platform'],
  reawakendBuildTips: ['build', 'optimize', 'class', 'traits', 'path'],
  reawakendCommunity: ['discord', 'community', 'official', 'channels'],
  reawakendUpdateLog: ['update', 'patch', 'balance', 'notes'],
  reawakendEarlyTips: ['early', 'tips', 'starter', 'first session'],
  reawakendFishingGuide: ['fishing', 'pets', 'gold', 'bait', 'pools'],
  reawakendSideQuestsGuide: ['side quests', 'quests', 'route', 'reward'],
  reawakendWeaponsGuide: ['weapons', 'sword', 'legendary', 'elite', 'speed'],
  reawakendSpellsGuide: ['spells', 'magic', 'attack', 'defense', 'charm'],
  reawakendGemsGuide: ['gems', 'socket', 'enchant', 'sockets', 'item power'],
  reawakendFameGuide: ['fame', 'renown', 'progression', 'stat'],
  reawakendEndgameGuide: ['endgame', 'late game', 'socket', 'enchant', 'renown'],
  reawakendCharacterImportGuide: ['character import', 'save', 'transfer', 'series'],
  reawakendHeirloomGuide: ['heirloom', 'descendant', 'retire', 'hero'],
  reawakendAchievementsGuide: ['achievements', 'pets', 'fishing', 'combat', 'economy'],
  reawakendCheatsGuide: ['cheats', 'console', 'commands', 'fate', 'cheat'],
  reawakendSteamDeckGuide: ['steam deck', 'controller', 'proton', 'pc', 'gamepad'],
}

const FILLER_WORDS = ['reawakend', 'reawakened', '2026', '2025', 'complete', 'the', 'and', 'for', 'how', 'with', 'our', 'this', 'your', 'all', 'from', 'learn', 'master']

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSignificantTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter(w => w.length > 2 && !FILLER_WORDS.includes(w))
}

function matchScore(queryText: string, article: ArticleWithType, extraKeywords?: string[]): number {
  const normalizedQuery = normalize(queryText)
  const normalizedTitle = normalize(article.frontmatter.title)
  const normalizedDesc = normalize(article.frontmatter.description || '')
  const normalizedSlug = article.slug.replace(/-/g, ' ').toLowerCase()

  let score = 0

  // Exact phrase match in title (stripped of "Reawakened")
  const strippedQuery = normalizedQuery.replace(/reawakened?\s*/g, '').trim()
  const strippedTitle = normalizedTitle.replace(/reawakened?\s*/g, '').trim()
  if (strippedQuery.length > 3 && strippedTitle.includes(strippedQuery)) {
    score += 100
  }

  // Token overlap from query text
  const queryTokens = getSignificantTokens(queryText)
  for (const token of queryTokens) {
    if (normalizedTitle.includes(token)) score += 20
    if (normalizedDesc.includes(token)) score += 5
    if (normalizedSlug.includes(token)) score += 15
  }

  // Extra keywords scoring (for module h2 titles)
  if (extraKeywords) {
    for (const kw of extraKeywords) {
      const normalizedKw = normalize(kw)
      if (normalizedTitle.includes(normalizedKw)) score += 15
      if (normalizedDesc.includes(normalizedKw)) score += 5
      if (normalizedSlug.includes(normalizedKw)) score += 10
    }
  }

  return score
}

function findBestMatch(
  queryText: string,
  articles: ArticleWithType[],
  extraKeywords?: string[],
  threshold = 20,
): ArticleLink | null {
  let bestScore = 0
  let bestArticle: ArticleWithType | null = null

  for (const article of articles) {
    const score = matchScore(queryText, article, extraKeywords)
    if (score > bestScore) {
      bestScore = score
      bestArticle = article
    }
  }

  if (bestScore >= threshold && bestArticle) {
    return {
      url: `/${bestArticle.contentType}/${bestArticle.slug}`,
      title: bestArticle.frontmatter.title,
    }
  }

  return null
}

export async function buildModuleLinkMap(locale: Language): Promise<ModuleLinkMap> {
  // 1. Load all articles across all content types
  const allArticles: ArticleWithType[] = []
  for (const contentType of CONTENT_TYPES) {
    const items = await getAllContent(contentType, locale)
    for (const item of items) {
      allArticles.push({ ...item, contentType })
    }
  }

  // 2. Load module data from en.json (use English for keyword matching)
  const enMessages = (await import('../locales/en.json')).default as any

  const linkMap: ModuleLinkMap = {}

  // 3. For each module, match h2 title and sub-items
  for (const [moduleKey, fieldConfig] of Object.entries(MODULE_FIELDS)) {
    const moduleData = enMessages.modules?.[moduleKey]
    if (!moduleData) continue

    // Match module h2 title (use extra keywords + lower threshold for broader matching)
    const moduleTitle = moduleData.title as string
    if (moduleTitle) {
      const extraKw = MODULE_EXTRA_KEYWORDS[moduleKey] || []
      linkMap[moduleKey] = findBestMatch(moduleTitle, allArticles, extraKw, 15)
    }

    // Match sub-items
    const subItems = moduleData[fieldConfig.field] as any[]
    if (Array.isArray(subItems)) {
      for (let i = 0; i < subItems.length; i++) {
        const itemName = subItems[i]?.[fieldConfig.nameKey] as string
        if (itemName) {
          const key = `${moduleKey}::${fieldConfig.field}::${i}`
          linkMap[key] = findBestMatch(itemName, allArticles)
        }
      }
    }
  }

  return linkMap
}
