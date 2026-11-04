# Store assets

Files uploaded by hand to the store consoles. All are generated from
`Branding/Mark.svg` by `scripts/brand/generate-brand-assets.mjs`; never edit
them directly.

| File | Where it goes |
| --- | --- |
| `google-play/icon-512.png` | Play Console, Store listing, App icon (512 × 512, 32-bit PNG, under 1 MB) |
| `app-store/app-icon-1024.png` | Nowhere in App Store Connect. The App Store icon comes from the submitted build (`apps/mobile/assets/icon.png`). This is a pixel-identical reference copy for review notes and press. |

`docs/mobile/icon-previews/store-assets-qa.png` shows each of them, and the
icons the native builds actually ship, under the platform masks.
