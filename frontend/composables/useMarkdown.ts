/**
 * Markdown renderer with code highlighting and copy-friendly output.
 * Shared singleton — initialised lazily on the client.
 */
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'

let _md: MarkdownIt | null = null

function buildMd(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
    highlight(str: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`
        } catch { /* fall through */ }
      }
      const escaped = md.utils.escapeHtml(str)
      return `<pre class="hljs"><code>${escaped}</code></pre>`
    },
  })

  // open links in new tab
  const defaultLink = md.renderer.rules.link_open
    || ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]
    t.attrSet('target', '_blank')
    t.attrSet('rel', 'noopener noreferrer')
    return defaultLink(tokens, idx, opts, env, self)
  }

  return md
}

export function useMarkdown() {
  if (!_md) _md = buildMd()
  const md = _md
  function render(src: string): string {
    if (!src) return ''
    return md.render(src)
  }
  return { render }
}
