import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

// Manual sidebar so the reading order is explicit and the source markdown in
// ../docs needs no Docusaurus frontmatter. Ids are paths relative to ../docs.
// The order is one path, beginner → production: Understand → Build → Ship &
// operate → Reference, with Under the hood last for the curious.
const sidebars: SidebarsConfig = {
    docs: [
        {
            type: 'category',
            label: 'Understand',
            collapsed: false,
            items: ['README', 'guide/packages', 'guide/core-concepts'],
        },
        {
            type: 'category',
            label: 'Build',
            collapsed: false,
            items: [
                'guide/getting-started',
                'guide/adding-methods',
                'guide/sessions-auth',
                'guide/server-push',
                'guide/testing',
                'guide/studio',
            ],
        },
        {
            type: 'category',
            label: 'Ship & operate',
            collapsed: false,
            items: [
                'guide/releasing-a-version',
                'guide/deployment',
                'guide/system-design',
                'guide/observability',
                'guide/production-checklist',
            ],
        },
        {
            type: 'category',
            label: 'Reference',
            collapsed: false,
            items: ['guide/faq', 'guide/configuration', 'guide/the-demo-app'],
        },
        {
            type: 'category',
            label: 'Under the hood',
            collapsed: true,
            items: ['internals/architecture', 'internals/protocol-compliance'],
        },
    ],
}

export default sidebars
