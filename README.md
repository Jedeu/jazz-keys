# Jazz Keys

A tiny, dependency-free piano for iPad. No App Store, paid tools, build step, samples, analytics, accounts in the app, or third-party requests.

## Open it on your iPad

**App URL: https://jedeu.github.io/jazz-keys/**

GitHub Pages hosts the app. No local server or running computer is needed.

1. Open the URL in **Safari**, rotate to landscape, and wait for **Ready for offline**.
2. Choose **Share → Add to Home Screen**. Enable **Open as Web App** if offered.
3. Open the new **Jazz Keys** icon while still online and wait for **Ready for offline** again.
4. Tap **Tap to play**. Test an offline launch using Airplane Mode.

The site and [source repository](https://github.com/Jedeu/jazz-keys) are public.

### v3: three octaves, two-thirds screen height

The keyboard spans the full width and covers **C3–B5: 36 keys across three octaves** (21 white, 15 black). White keys occupy **exactly two-thirds of the visible viewport height**; the chord strip and non-playing space sit above them. For example, an 834 px-high viewport gives 556 px-long white keys. The height follows Safari's visible viewport as its toolbars change.

This is the user's chosen screen-based layout, not a claim of measured acoustic-piano proportions. Black keys retain the existing 61% relative length and 62% relative width. The earlier heuristic 6:1 white-key ratio has been removed.

Touch input now reconciles against the current finger list, so a missed release or reused touch ID can be cleaned up on the next event. The small **Reset** button clears all keys and recreates the sound engine without reloading the page. A hung audio-start request times out rather than leaving the start button disabled forever. No input polling or permanent timers were added.

**To get the update:** open/reload the app while online, leave it open briefly to download, then close all Jazz Keys Safari tabs and the Home Screen app. Reopen it; **v3** appears at the bottom of the welcome screen. Updates intentionally do not replace a session while you're playing.

## Try it on this Mac

If Node is already installed:

```sh
npm start
```

Open **http://127.0.0.1:4173**. No `npm install` is needed. Stop the server with Ctrl+C.

Alternatively, if Python is already installed, run `python3 -m http.server 4173 --bind 127.0.0.1` in this folder. Don’t open `index.html` by double-clicking: JavaScript modules and offline installation need a web server.

## Put it on your iPad — no paid tools or software installation

**The one catch:** Safari needs an **HTTPS URL** to cache a Home Screen app for offline use. A local file, email attachment, or `http://192.168…` address does not provide this. Once hosted, the app runs on your iPad; your computer and local preview server can stay off.

The existing app URL above is already configured. To create a separate deployment using free GitHub Pages:

1. Sign in to GitHub and create a **public** repository, such as `jazz-keys`. Only hosting setup needs a GitHub account; the piano does not.
2. Use **Add file → Upload files** to upload `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, the entire `src/` and `icons/` folders, and `.nojekyll`. Keep their directory structure. Commit the files. The tests, scripts, and package file are not needed on the host.
3. Open the repository’s **Settings → Pages**. Choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. When GitHub shows the site URL, open it in **Safari on your iPad**. It should look like `https://YOUR-NAME.github.io/jazz-keys/`.
5. In landscape, wait until the welcome screen says **Ready for offline**.
6. In Safari, choose **Share → Add to Home Screen** (you may need **View More**). If offered, turn on **Open as Web App**, then tap **Add**.
7. Open **Jazz Keys from its new Home Screen icon while still online**, and wait for **Ready for offline** there too. Then tap **Tap to play**.
8. Test it: close the app, enable Airplane Mode, reopen the icon, and play a chord. After the initial cache is complete, your computer and the server do not need to stay on.

**Privacy:** Free GitHub Pages requires a public repository, and the site is publicly accessible. This is not an App Store release, but it is not private hosting either. Don’t upload personal material. If you want a strictly private site, use an existing trusted HTTPS host instead; don’t publish to Pages. All app URLs are relative, so hosting under a folder works.

The app makes no API, telemetry, CDN, font, or sample requests. Initial installation and browser-managed update checks still fetch its own static files. Safari can remove cached website data under storage pressure or when you clear website data; reopen online to restore it. Offline is not a permanent-storage guarantee.

## Playing

- Landscape, **C3–B5**: 36 semitones, 21 white keys and 15 black keys.
- Tap once to unlock audio, then play with both hands. Keep **Silent Mode off** and use the iPad’s volume buttons; start at a comfortable volume.
- Use built-in speakers or a wired connection for latency testing. Bluetooth can add noticeable delay.
- Moving within a key does not retrigger it. Crossing into another key deliberately releases the old note and plays the new one. Two fingers sharing a key share one voice until the last finger leaves.
- Notes have a short, piano-like decay even if held; there is no sustain pedal. This is a lightweight synthesized approximation, not a sampled acoustic piano.
- The chord strip follows **held keys**, not fading release tails. It is blank with fewer than three distinct pitch classes; `—` means no supported match.
- The sound engine rests about 30 seconds after the last voice finishes. The next new note wakes it. Locking, switching away, or rotating releases all notes and suspends audio immediately.
- If Safari interrupts audio, use **Tap to resume**. If keys or sound get stuck, tap **Reset** in the strip, then lift and retouch the keys. If sound is missing, check Silent Mode, volume, and output routing.
- iPadOS system gestures can intercept multi-finger touches. If that happens, check your version’s multitasking/gesture options in iPad Settings. The app cleans up canceled touches, but cannot disable OS gestures.
- Desktop access: use the mouse, or Tab to a key and hold Space/Enter. There is no computer-keyboard piano mapping.

## Chord recognition

Required families: major/minor seventh, dominant seventh, half-diminished, diminished seventh, sixths, dominant ninths, major/minor ninths, and inversions/slash bass. Also includes triads, suspended/add9/6/9 chords, common altered dominants, and selected 11th/13th voicings.

Matching ignores touch order and octave doubling, permits omitted unaltered fifths in extended chords, and permits omitted ninths in thirteenths. Rootless ninths are inferred only when their characteristic tones are present and no stronger played-root interpretation exists.

A set of notes does not have one universally correct chord name. The detector prefers complete matches, then a root in the bass; inferred roots and unrelated slash basses carry penalties. For example, `C E G A` with C lowest is **C6**, while `A C E G` with A lowest is **Am7**. `E G B D` is **Em7**, not an assumed rootless Cmaj9. No harmonic-context or key-signature guessing is done. Altered-rootless voicings and polychords are not exhaustive. “90%+ correct” needs evaluation against **your actual practice voicings**, not just the included template tests.

Try these within the available range:

| Chord | Notes |
|---|---|
| Dm7 | D3 F3 A3 C4 |
| G7 | G3 B3 D4 F4 |
| Cmaj9 | C3 E3 G3 B3 D4 |
| Cm7♭5 | C3 E♭3 G♭3 B♭3 |
| Cmaj7/E | E3 G3 B3 C4 |
| Cmaj13 | C3 E3 G3 B3 D4 A4 |

## Battery design

No animation, canvas, frame loop, polling, wake lock, microphone, or background audio. DOM changes happen on input, layout, or lifecycle/status events. Audio uses one harmonic oscillator, one low-pass filter, and one gain envelope per note, with a shared compressor for headroom. Finished voices disconnect; rapid glides are capped at 32 concurrent voices including release tails.

Use about **40% brightness** and **Low Power Mode**. The dark palette is for comfort, not a claim of LCD power savings. iPadOS retains control over screen dimming/locking; the app never requests a wake lock.

## Check it

```sh
npm test
```

Uses only Node’s test runner (Node 22+ recommended). Covers transposed chord families, shells, inversions, ambiguities, ten contacts, shared notes, missed releases, reused touch IDs, inert-space touches, glide hit-testing, engine disposal, idle sleep, and suspend/resume races. Audio unit tests use a fake context; they do not assess timbre or real latency.

Optional real-browser smoke test with **already installed Chrome** and Node 22+:

```sh
node scripts/browser-smoke.mjs
# Check the live deployment without starting a local server:
APP_URL=https://jedeu.github.io/jazz-keys/ node scripts/browser-smoke.mjs
# Other Chrome location:
CHROME_BIN=/path/to/chrome node scripts/browser-smoke.mjs
```

No packages or browsers are downloaded. It runs real Web Audio in headless Chrome, injects six simultaneous touches, checks the three-octave range, two-thirds-height layout at multiple viewport sizes, upper-octave input, and inert space, simulates dropped release events and hung resume promises, and tests Reset, glide/shared keys, rotation/blur cleanup, wake, and offline reload. Screenshots go in `.tmp/`. This is not an iPad Safari test.

### iPad acceptance checklist — still required

- [ ] Home Screen launch has no Safari address bar; portrait shows the rotation message.
- [ ] Six to ten fingers sound together, including mixed white/black keys. No unwanted OS gesture takes over.
- [ ] Gliding sounds only new keys; shared-key releases don’t cut off the other finger.
- [ ] No stuck notes after lifting, canceled touches, rotation, locking, or app switching.
- [ ] All three octaves (C3–B5) are playable; white keys fill two-thirds of the visible screen height and touching the empty space never plays a note.
- [ ] Reset clears all keys and restores playing without a page refresh.
- [ ] After 30 seconds of silence, the status says **Resting**; a new note wakes it promptly.
- [ ] Airplane Mode + fully closed app + Home Screen reopen still plays and names chords.
- [ ] Touch-to-sound feels under 50 ms with built-in speakers/wired audio. Check idle wake separately.
- [ ] Log at least 30 representative jazz voicings and accept musically equivalent names; target 90%+.
- [ ] Compare separate 30-minute Jazz Keys and GarageBand sessions at the same brightness, output, volume, Low Power Mode, starting battery range, and playing pattern. Record start/end battery %. Repeat; a single battery-percentage reading is coarse.

**Not yet measured:** physical iPad latency, chord accuracy on your personal repertoire, and battery savings versus GarageBand. There is no claimed battery or latency guarantee.

## Files and updates

- `index.html`, `styles.css`: playing surface and portrait/start screens
- `src/app.js`, `src/input.js`: DOM, native touch reconciliation, pointer capture, note ownership and lifecycle
- `src/audio.js`: oscillator synthesis and idle suspension
- `src/chords.js`: deterministic chord matching
- `sw.js`, `manifest.webmanifest`, `icons/`: offline/Home Screen support
- `tests/`, `scripts/`: optional development checks; not app dependencies

When publishing a change, bump the cache version (currently `v3`) in `sw.js`. All app-shell files cache atomically. Updates wait until existing tabs/app windows close, so a playing session is not replaced mid-chord. Reopen online to fetch an update, close all instances, then reopen to activate it. After changing the icon art, `python3 scripts/make-icons.py` regenerates the included PNGs with Python’s standard library.

## Setup references

- [Apple: turn a website into an app on iPad](https://support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/ipados)
- [GitHub: create a Pages site; free/public hosting requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [MDN: service workers and HTTPS requirements](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [MDN: Web Audio user-gesture requirements](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [MDN: the live touch list](https://developer.mozilla.org/en-US/docs/Web/API/TouchEvent/touches)
- [MDN: changed touches and cancellation](https://developer.mozilla.org/en-US/docs/Web/API/TouchEvent/changedTouches)
