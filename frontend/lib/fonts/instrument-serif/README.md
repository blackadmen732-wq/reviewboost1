# Instrument Serif

Regular and Italic, self-hosted with `next/font/local` for public marketing display headings. The site loads the two `*-latin.woff2` files; the `.ttf` files beside them are the unmodified upstream originals they are made from. No Reserved Font Name is declared, so the OFL allows the subset.

To regenerate (fonttools with brotli):

```sh
pyftsubset InstrumentSerif-Regular.ttf --flavor=woff2 --layout-features='*' \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD' \
  --output-file=InstrumentSerif-Regular-latin.woff2
```

and the same for Italic. The range is Latin plus punctuation, which covers English, Spanish and Haitian Creole. Body/owner typography remains Geist; customer typography remains Inter Tight/DM Sans. The shared declaration is `../public-editorial.ts`.

Source: https://github.com/google/fonts/tree/66928797f271fed5ee428544e7229685e2d90127/ofl/instrumentserif

Copyright 2022 The Instrument Serif Project Authors. SIL Open Font License 1.1 is included in `OFL.txt`. No browser request to a font provider is required.
