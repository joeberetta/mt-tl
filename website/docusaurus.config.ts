import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'
import { themes as prismThemes } from 'prism-react-renderer'

// GitHub Pages project site → https://joeberetta.github.io/mt-tl/
// `url` + `baseUrl` only matter for production builds (sitemap/canonical/asset
// paths); the localhost dev server ignores `url`.
const SITE_URL = 'https://joeberetta.github.io'
const REPO_URL = 'https://github.com/joeberetta/mt-tl'
const ORG_NAME = 'joeberetta'
const PROJECT_NAME = 'mt-tl'

const config: Config = {
    title: 'mt-tl',
    tagline: 'Build an MTProto 2.0 server the way you build a Fastify app',
    url: SITE_URL,
    // Project site lives under /<repo>/. A user/org site (joeberetta.github.io)
    // would use '/'.
    baseUrl: '/mt-tl/',
    organizationName: ORG_NAME,
    projectName: PROJECT_NAME,

    // The docs are the site (docs-only mode). Repo-file links (../../examples, ../../packages)
    // resolve only on GitHub, so they're warnings here until they're made absolute.
    onBrokenLinks: 'warn',

    // The docs are hand-written CommonMark (autolinks `<url>`, `Vector<T>`, `{ … }`
    // in prose) — parse `.md` as CommonMark, not MDX, so those don't trip the JSX
    // parser. (`.mdx` files, if any, still use MDX.)
    markdown: { format: 'detect', hooks: { onBrokenMarkdownLinks: 'warn' } },

    i18n: { defaultLocale: 'en', locales: ['en'] },

    presets: [
        [
            'classic',
            {
                docs: {
                    // Single source of truth: the markdown lives in the repo-root ../docs.
                    path: '../docs',
                    routeBasePath: '/',
                    sidebarPath: './sidebars.ts',
                    editUrl: `${REPO_URL}/edit/master/docs/`,
                },
                blog: false,
                theme: { customCss: './src/css/custom.css' },
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        navbar: {
            title: 'mt-tl',
            items: [
                { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
                { href: REPO_URL, label: 'GitHub', position: 'right' },
            ],
        },
        footer: {
            style: 'dark',
            links: [
                {
                    title: 'Docs',
                    items: [
                        { label: 'Your first server', to: '/guide/getting-started' },
                        { label: 'How it works', to: '/guide/core-concepts' },
                        { label: 'Deployment', to: '/guide/deployment' },
                    ],
                },
                { title: 'More', items: [{ label: 'GitHub', href: REPO_URL }] },
            ],
            copyright: `MIT licensed. Copyright © ${new Date().getFullYear()} mt-tl.`,
        },
        prism: {
            theme: prismThemes.github,
            darkTheme: prismThemes.dracula,
            additionalLanguages: ['bash', 'json'],
        },
    } satisfies Preset.ThemeConfig,
}

export default config
