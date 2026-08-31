# ReviewBoost Stands — Real Device Test Checklist

## Hardware Requirements

- iPhone 7 or later (NFC writing requires iPhone 7+, iOS 13+)
- Android phone with NFC (Chrome 89+ for Web NFC)
- NFC tags: NTAG213, NTAG215, or NTAG216 (blank, not write-locked)
- Printed QR code from ReviewBoost dashboard

## Prerequisites

- ReviewBoost account with owner or admin role
- At least one active stand configured
- Mobile app built with Expo dev build (not Expo Go — NFC requires native module)

---

## QR Code Tests

### Web Dashboard

- [ ] Navigate to "Your codes" page
- [ ] Verify QR code loads and displays correctly
- [ ] Click "Print this code" — verify print dialog opens
- [ ] Click "Save SVG" — verify SVG file downloads
- [ ] Select each PNG size (300, 512, 1024, 2048) and click "Save PNG"
- [ ] Verify each PNG downloads at the correct resolution
- [ ] Scan a downloaded QR code with phone camera — verify it opens the correct `/q/[token]` URL
- [ ] Scan at arm's length (30cm) — should resolve on first try

### Mobile App

- [ ] Open "Stands" tab — verify stands list loads
- [ ] Pull to refresh — verify list updates
- [ ] Verify each stand shows label, token prefix, and status badge
- [ ] Tap a stand — verify detail screen opens

---

## NFC Write Tests — iPhone (react-native-nfc-manager)

> Requires Expo dev build. Will not work in Expo Go.

- [ ] Open stand detail screen on iPhone
- [ ] Tap "Write to NFC Tag"
- [ ] Hold NTAG215 tag to top-back of iPhone
- [ ] Verify "NFC tag written and verified successfully" message appears
- [ ] Verify tag UID is displayed (if available)
- [ ] Tap the written NFC tag with phone — verify Safari opens the correct ReviewBoost URL
- [ ] Tap the tag with a different phone — verify it works across devices
- [ ] Attempt write with NFC disabled in Settings — verify error message
- [ ] Cancel during write — verify clean cancellation

### Edge Cases (iPhone)

- [ ] Write to an NTAG213 tag (smallest, 144 bytes) — should succeed
- [ ] Write to an already-written tag — should overwrite
- [ ] Write to a write-locked tag — should show error
- [ ] Write with weak NFC signal (tag at edge of read range) — should either succeed or show clear error

---

## NFC Write Tests — Android Chrome (Web NFC)

> Requires Chrome 89+ on Android with NFC enabled.

- [ ] Open ReviewBoost dashboard in Chrome on Android
- [ ] Navigate to "Your codes" page
- [ ] Expand "Write to NFC tag" section
- [ ] Verify "Write NFC Tag (Android Chrome)" section appears
- [ ] Tap "Write to NFC Tag"
- [ ] Accept NFC permission prompt
- [ ] Hold NTAG215 tag to back of phone
- [ ] Verify success message with tag UID
- [ ] Tap the written tag — verify Chrome opens the correct URL
- [ ] Tap with iPhone — verify cross-device compatibility
- [ ] Test in Firefox on Android — verify Web NFC section does not appear (unsupported)

### Edge Cases (Android)

- [ ] Deny NFC permission — verify "permission denied" error
- [ ] Turn off NFC in Settings — verify appropriate error message
- [ ] Open dashboard in non-Chrome browser — verify Web NFC section hidden

---

## NFC Tools Fallback Tests

- [ ] Install NFC Tools app (iOS or Android)
- [ ] Follow the instructions in the "Using NFC Tools" section on the dashboard
- [ ] Write a stand URL to an NFC tag via NFC Tools
- [ ] Verify the tag opens the correct ReviewBoost URL when tapped

---

## Token Rotation + NFC Tests

- [ ] Provision an NFC tag for a stand
- [ ] Verify "NFC tag written" status appears on dashboard
- [ ] Rotate the stand's token ("Make a new code")
- [ ] Verify rotation warning mentions NFC: "rewrite the NFC tag"
- [ ] Verify dashboard shows "NFC tag needs rewriting" warning
- [ ] Verify old NFC tag no longer works (shows inactive/not found page)
- [ ] Write the new token to the NFC tag
- [ ] Verify "NFC tag needs rewriting" warning clears
- [ ] Verify tag now opens the correct updated URL

---

## Permission Tests

- [ ] Sign in as member role — verify NFC write option is not available
- [ ] Sign in as viewer role — verify NFC write option is not available
- [ ] Sign in as admin role — verify NFC write works
- [ ] Sign in as owner role — verify NFC write works
- [ ] Attempt POST to `/api/v1/review-stands/{id}/nfc-provision` as member — verify 403

---

## Cross-Platform Compatibility

- [ ] NFC tag written on iPhone reads correctly on Android
- [ ] NFC tag written on Android reads correctly on iPhone
- [ ] NFC tag written via Web NFC reads correctly on both platforms
- [ ] NFC tag written via NFC Tools reads correctly on both platforms
- [ ] QR code and NFC tag for same stand both resolve to identical URL

---

## Regression Checks

- [ ] Existing QR codes still scan and work
- [ ] Customer flow (`/q/[token]`) unchanged — star rating, feedback, Google redirect all work
- [ ] Live Feed and Feedback tabs still function in mobile app
- [ ] Token rotation still works for QR-only stands
- [ ] Dashboard loads without errors for stands with no NFC provisioning
