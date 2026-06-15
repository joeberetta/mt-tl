import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

// Manual sidebar so the reading order is explicit and the source markdown in
// ../docs needs no Docusaurus frontmatter. Ids are paths relative to ../docs.
const sidebars: SidebarsConfig = {
    docs: [
        'README',
        {
            type: 'category',
            label: 'Guide',
            collapsed: false,
            items: [
                'guide/getting-started',
                'guide/core-concepts',
                'guide/adding-methods',
                'guide/sessions-auth',
                'guide/the-demo-app',
                'guide/releasing-a-version',
                'guide/deployment',
                'guide/observability',
            ],
        },
        {
            type: 'category',
            label: 'Internals',
            items: ['internals/architecture', 'internals/protocol-compliance', 'internals/msgkey-v1-quirk'],
        },
    ],
}

export default sidebars
