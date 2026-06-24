import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the built site can be hosted under any path (GH Pages
// subpath, S3 prefix, …). The app fetches ./api.json at runtime.
export default defineConfig({
    plugins: [react()],
    base: './',
    build: { outDir: 'dist/app', emptyOutDir: true },
})
