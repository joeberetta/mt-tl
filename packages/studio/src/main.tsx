import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import './styles.css'
// Mobile / responsive layer — kept separate from styles.css so it composes cleanly
// (imported last → its equal-specificity rules win the cascade).
import './responsive.css'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
