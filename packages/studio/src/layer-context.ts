import { createContext } from 'react'

/** The studio's selected TL layer — pins the whole site (docs, schema, changelog). */
export const LayerCtx = createContext<{ layer: number; setLayer: (n: number) => void }>({
    layer: 0,
    setLayer: () => {},
})
