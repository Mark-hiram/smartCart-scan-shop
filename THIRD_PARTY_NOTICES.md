# Third-Party Notices

This application ("Smart Cart") is proprietary software. Portions of this application incorporate third-party open-source packages, fonts, and bundled assets listed below. Version numbers and licence identifiers for npm packages were inspected directly from `node_modules/*/package.json`.

## 1. Runtime Dependencies (`package.json`)

| Package | Installed Version | Licence |
| :--- | :--- | :--- |
| `@google/genai` | 3.6.1 | Apache-2.0 |
| `@tailwindcss/vite` | 4.3.5 | MIT |
| `@types/qrcode` | 1.5.6 | MIT |
| `@vitejs/plugin-react` | 6.3.0 | MIT |
| `dotenv` | 17.4.2 | BSD-2-Clause |
| `express` | 4.22.3 | MIT |
| `jsqr` | 1.4.0 | Apache-2.0 |
| `lucide-react` | 0.546.0 | ISC |
| `motion` | 12.43.0 | MIT |
| `qrcode` | 1.5.4 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `react-markdown` | 10.1.0 | MIT |
| `tsx` | 4.23.15 | MIT |
| `typescript` | 7.0.2 | Apache-2.0 |
| `vite` | 8.3.7 | MIT |

## 2. Development Dependencies (`package.json`)

| Package | Installed Version | Licence |
| :--- | :--- | :--- |
| `@types/express` | 4.17.25 | MIT |
| `@types/node` | 22.20.5 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `@types/react-dom` | 19.3.0 | MIT |
| `autoprefixer` | 10.6.2 | MIT |
| `esbuild` | 0.25.12 | MIT |
| `tailwindcss` | 4.3.5 | MIT |

## 3. Fonts, Icons & Bundled Visual Assets

| Asset / Resource | Source | Licence |
| :--- | :--- | :--- |
| `Plus Jakarta Sans` font | Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`, loaded via `<link>` in `index.html` and cached by `sw.js`) | SIL Open Font License 1.1 (OFL-1.1) |
| `JetBrains Mono` font | Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`, loaded via `<link>` in `index.html` and cached by `sw.js`) | SIL Open Font License 1.1 (OFL-1.1) |
| UI Icon Set (`lucide-react`) | Bundled via npm (`lucide-react@0.546.0`) | ISC |
| Portal SVG background patterns, brand logos & inline illustrations (`src/styles/themes.css`, `src/components/Illustrations.tsx`, `src/assets/logo/*.svg`, `public/icon.svg`) | Original SVG artwork created in this repository | Proprietary — SmartCart Owner |
| `public/favicon.ico` (16/32/48 px), `public/apple-touch-icon.png` (180x180 PNG), `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/pwa-maskable-512x512.png` | Rasterized directly from `src/assets/logo/smartcart-mark.svg` / `public/icon.svg` | Proprietary — SmartCart Owner |
