# ReviewBoost brand

One mark, one green, one source. Everything in this folder except `Mark.svg`
and `Wordmark.svg` is generated.

## Files

| File | What it is | Made by |
| --- | --- | --- |
| `Mark.svg` | The R speech-bubble mark alone: no background, container, rotation or padding. **The source of truth.** | Hand-drawn. Edit this. |
| `Wordmark.svg` | "ReviewBoost" in Geist SemiBold, converted to outlines. | `scripts/brand/outline-wordmark.py` |
| `Logo.svg` | Horizontal lockup, `[mark] ReviewBoost`, for light backgrounds. | `scripts/brand/generate-brand-assets.mjs` |
| `Logo-on-dark.svg` | The same lockup with "Review" in light ink, for dark backgrounds. | same |
| `AppIcon.svg` | App-icon artwork: a full square of brand green with the white mark centred. | same |

The generator also writes the web mark's geometry
(`frontend/components/brand/mark-geometry.ts`), every favicon, PWA and link
preview image in `frontend/public/brand/`, the iOS icon, Android adaptive
layers and in-app mark rasters in `apps/mobile/assets/`, and the store
listing assets in `store-assets/` (Google Play icon, App Store reference).

## Changing the brand

```sh
cd frontend && npm ci && cd ..
node scripts/brand/generate-brand-assets.mjs
```

Commit what it writes. Never edit a generated SVG or PNG by hand;
`frontend/tests/unit/brand-assets.test.ts` fails if anything draws or colours
the mark on its own.

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| Brand green | `#00A86B` | **The only logo green.** The mark, "Boost" in the wordmark, the app-icon and Android adaptive-icon background. Web `--rb-brand`, mobile `colors.brand`. |
| Ink | `#171A18` | "Review" in the wordmark on light backgrounds. Web `--rb-ink`. |
| Ink on dark | `#F7F9F7` | "Review" on dark backgrounds. |
| White | `#FFFFFF` | The mark on the app icon. |
| Action green | `#007A4D` | UI only: buttons, links and running text that needs 4.5:1 on white. **Never a logo colour.** |

`#035B3B`, the dark green of the old rotated icon tile, is retired.

## Rules

- The app icon is a full square. iOS and Android draw the rounded square,
  circle or squircle; we never bake a corner radius, a circle or a rotation
  into the artwork. The "circle" and "rectangle" icons on the brand sheet are
  the same artwork under two OS masks.
- The mark's counter is a hole, so it works on any background. On brand green
  the mark is white; everywhere else it is brand green.
- Store QA: after `npx expo prebuild`, `scripts/brand/render-store-qa.py`
  checks and renders what the iOS and Android builds actually ship.
- Minimum size: 16px tall. The QA sheet in `docs/mobile/icon-previews/brand-qa.png`
  shows it from 16px up.
- Clearspace around the mark or lockup: a quarter of the mark's height.
