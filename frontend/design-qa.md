# ReviewBoost customer-flow design QA

## Approved palette

- Primary `#06C167`
- Hover `#059A52`
- Background `#F8F5F0`
- Surface `#FFFFFF`
- Text `#111111`
- Muted text `#555555`
- Border `#E5E5E5`

## Implemented

- Premium mobile-first customer rating flow with a contained desktop surface.
- 56–70px rating targets with keyboard radio semantics and equal haptic feedback.
- Sticky safe-area-aware mobile action bar and keyboard-safe input scroll margins.
- Identical Google-review opportunity for ratings 1–5.
- Recoverable offline, loading, inactive-token, error, success, and finished states.
- Light, dark, explicit theme override, reduced-motion, and forced-color support.
- Reusable Button, Card, Input, Textarea, Container, Section, EmptyState, LoadingState, and ErrorState components.
- Production bundle guard preventing development fixtures from shipping.
