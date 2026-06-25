import type { CSSProperties } from 'react'

/**
 * Inline Tabler icons (https://tabler.io/icons — MIT). The studio bundles no
 * icon webfont, so each glyph it uses is embedded here as its outline path data:
 * icons render offline with zero runtime dependencies. Each SVG is sized in `em`
 * and stroked with `currentColor`, so callers size it via `fontSize` and tint it
 * via `color` — exactly as they would a font glyph.
 */
export type IconName =
    | 'alert-triangle'
    | 'check'
    | 'chevron-down'
    | 'chevron-right'
    | 'copy'
    | 'device-floppy'
    | 'download'
    | 'key'
    | 'link'
    | 'loader-2'
    | 'menu'
    | 'player-play'
    | 'player-stop'
    | 'plus'
    | 'search'
    | 'text-wrap'
    | 'trash'
    | 'upload'
    | 'user-check'
    | 'user-off'
    | 'x'

const PATHS: Record<IconName, string[]> = {
    'alert-triangle': [
        'M12 9v4',
        'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z',
        'M12 16h.01',
    ],
    check: ['M5 12l5 5l10 -10'],
    'chevron-down': ['M6 9l6 6l6 -6'],
    'chevron-right': ['M9 6l6 6l-6 6'],
    copy: [
        'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z',
        'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
    ],
    'device-floppy': [
        'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2',
        'M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
        'M14 4l0 4l-6 0l0 -4',
    ],
    download: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12'],
    key: [
        'M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z',
        'M15 9h.01',
    ],
    link: [
        'M9 15l6 -6',
        'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
        'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
    ],
    'loader-2': ['M12 3a9 9 0 1 0 9 9'],
    menu: ['M4 6l16 0', 'M4 12l16 0', 'M4 18l16 0'],
    'player-play': ['M7 4v16l13 -8z'],
    'player-stop': ['M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z'],
    plus: ['M12 5l0 14', 'M5 12l14 0'],
    search: ['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
    'text-wrap': ['M4 6l16 0', 'M4 18l5 0', 'M4 12h13a3 3 0 0 1 0 6h-4l2 -2m0 4l-2 -2'],
    trash: [
        'M4 7l16 0',
        'M10 11l0 6',
        'M14 11l0 6',
        'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
        'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
    ],
    upload: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 9l5 -5l5 5', 'M12 4l0 12'],
    'user-check': ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M6 21v-2a4 4 0 0 1 4 -4h4', 'M15 19l2 2l4 -4'],
    'user-off': [
        'M8.18 8.189a4.01 4.01 0 0 0 2.616 2.627m3.507 -.545a4 4 0 1 0 -5.59 -5.552',
        'M6 21v-2a4 4 0 0 1 4 -4h4c.412 0 .81 .062 1.183 .178m2.633 2.618c.12 .38 .184 .785 .184 1.204v2',
        'M3 3l18 18',
    ],
    x: ['M18 6l-12 12', 'M6 6l12 12'],
}

export function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
    const cls = ['icon', name === 'loader-2' && 'icon-spin', className].filter(Boolean).join(' ')
    return (
        <svg
            className={cls}
            style={style}
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {PATHS[name].map((d, i) => (
                <path key={i} d={d} />
            ))}
        </svg>
    )
}
