import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vitepress'
import ThemeSwitcher from './ThemeSwitcher.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import GitHubLink from './GitHubLink.vue'
import BetaBadge from './BetaBadge.vue'
import { initComponent as initMarkmap } from 'vitepress-markmap-preview/component'
import { initCJKSpacing } from './cjkSpacing'
import { redirectLegacyFragment } from './legacyAnchors'
import 'vitepress-markmap-preview/dist/index.css'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    initMarkmap(app)
  },
  setup() {
    const route = useRoute()
    // Apply CJK letter-spacing after initial mount and on each navigation
    onMounted(() => initCJKSpacing())
    watch(() => route.path, () => nextTick(() => initCJKSpacing()))
    // Deep links minted before heading ids were recomposed (NFC) still land.
    onMounted(() => {
      nextTick(redirectLegacyFragment)
      window.addEventListener('hashchange', redirectLegacyFragment)
    })
    watch(() => route.path, () => nextTick(redirectLegacyFragment))
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-title-after': () => h(BetaBadge),
      'nav-bar-content-after': () => h('div', { class: 'nav-icons' }, [
        h(LanguageSwitcher),
        h(ThemeSwitcher),
        h(GitHubLink),
      ]),
    })
  },
} satisfies Theme
