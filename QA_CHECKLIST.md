# Debate.Me — Cross-Browser Sanity Checklist

## Browsers
- Desktop: Chrome, Edge, Firefox (latest)
- Mobile: iOS Safari, Android Chrome

## Steps
1. Visit `/login` → request OTP → verify → redirected to `/`.
   - [ ] OTP email received and 6-digit code visible
   - [ ] Successful sign-in shows email at top of home page

2. Open `/profile`
   - [ ] Edit display name → Save → refresh → persists

3. Open `/room/deb-test-123`
   - [ ] Prejoin loads (name field visible)
   - [ ] Can select mic/camera (device menu opens)
   - [ ] Permissions prompt appears and accepts
   - [ ] Video/mic indicators show activity

4. Open same room on a second browser/device
   - [ ] Both tiles connect (self and other)
   - [ ] Audio is heard on each side
   - [ ] UI scales on mobile (no overlapped elements)

## Screen sizes
- [ ] 360×740 (small phone)
- [ ] 768×1024 (tablet portrait)
- [ ] 1280×800 (laptop)
- [ ] 1440×900+ (desktop)

## Notes / Regressions
- …
- Website little icon doesn’t appear in iphone, instead the vercel one does
- When loading into a room, it says "The conference has not yet started because no moderators have yet arrived... and then asks me to log in"
- In iphone, in the welcome screen after signing in, the save button on the right od the space where you enter your username, in iPhone is barely over the gray rectangle that surrounds that section, like the edge of the save button is barely over the line when it should be entirely inside