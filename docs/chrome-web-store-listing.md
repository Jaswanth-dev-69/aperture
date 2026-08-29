# Chrome Web Store listing (draft)

Submission itself requires a Google account, the one-time $5 developer registration
fee, and manual upload through the [Chrome Web Store Developer
Dashboard](https://chrome.google.com/webstore/devconsole) — none of that can be
automated. This file is the copy-paste-ready content for when that happens.

## Store listing

**Name**
Aperture — Privacy-First Browser Automation

**Summary** (132 characters max)
Records and replays browser macros entirely on-device. No screenshot or page
content ever leaves your machine.

**Category**
Productivity

**Detailed description**

> Aperture records what you do in the browser — clicks, typing, scrolling, whole
> multi-page checkout flows — and replays it later. No screenshot, no keystroke, no
> page content is ever sent anywhere. It happens on your machine, or it doesn't
> happen.
>
> Most browser automation tools today — including the new wave of AI browser
> agents — work by sending your screen to a server and asking a model what to do
> next. That's a bad trade when the tab you're automating has your bank, your
> patient records, or your employer's internal tools open.
>
> Aperture takes the other trade. It fingerprints the elements you interact with —
> by id, label, visible text, and structural position — and uses that same
> resilient chain to find them again later, entirely inside your browser.
>
> **How it works**
> 1. Record — click and type once; every action is captured, including real pauses
>    between steps and navigation across multiple pages.
> 2. Aperture remembers each element five different ways, so replay survives minor
>    page changes instead of breaking on the first layout shift.
> 3. Replay at 1× — reproduces your actual pacing, with each element highlighted
>    before it's acted on so you can watch it work.
>
> Zero network calls in the core record/replay loop. Open source, MIT licensed.

**Screenshots needed** (1280×800 or 640×400, at least one required)
- [ ] Side panel showing the macro list
- [ ] Side panel mid-recording, showing the live capture feed
- [ ] Replay in progress with an element highlighted on a page
- [ ] The action log after a completed replay

**Promotional tile images** (optional but recommended)
- [ ] Small tile — 440×280
- [ ] Marquee — 1400×560

**Privacy practices disclosure**
Aperture's manifest permissions: `activeTab`, `scripting`, `sidePanel`, `storage`,
`tabs`. None of these are used to transmit data off-device — `chrome.storage` calls
stay local to the browser profile. When filling out the Chrome Web Store's privacy
questionnaire:
- Does not collect or transmit any user data.
- Does not use remote code.
- Single purpose: records and replays user-initiated browser actions.

**Support / homepage URL**
https://github.com/Jaswanth-dev-69/aperture

## Before submitting

- [ ] Capture the four screenshots above against the practice site (stable, won't
      change under you the way a real website might)
- [ ] Register a Chrome Web Store developer account (one-time $5 fee)
- [ ] Upload `aperture-v0.1.0.zip` from the GitHub release, or a fresh
      `npm run build` zip of `extension/dist`
- [ ] Expect review lag — keep the GitHub release `.zip` linked from the README as
      a fallback "load unpacked" install path until the listing is approved
