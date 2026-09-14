# Releasing Motion Plug

Motion Plug follows the same release shape as Caption Plug while keeping updates completely public and account-free.

## Build locally

Synchronize the version and build the current machine's installer:

```sh
npm run version:set -- 0.3.1
MP_TARGET_PLATFORM=mac-universal npm run release
```

On Windows (or a machine with NSIS available):

```sh
MP_TARGET_PLATFORM=win-x64 npm run release
```

Artifacts are written to `release/`:

- `MotionPlug-vX.Y.Z.zip` — platform-independent in-panel update payload
- `MotionPlug-vX.Y.Z.zip.sha256` — publishable integrity checksum
- `latest.json` — public updater manifest
- `MotionPlug-vX.Y.Z-mac-universal.pkg` — Apple Silicon + Intel installer
- `MotionPlug-Setup-X.Y.Z.exe` — Windows x64 installer and uninstaller

`build-release.sh` runs type checking, tests, the production build, runtime validation, and release validation before it reports success. The ZIP contains only the compiled extension tree; source, tests, build scripts, and dependencies do not ship.

## Public update endpoint

The panel reads:

```text
https://www.captionplug.com/api/motion-plug/latest
```

That feed is served by the Caption Plug website deployment, which already hosts
Motion Plug's pages, checkout, and release storage. It responds to `GET` without
authentication and returns the same fields generated in `release/latest.json`:

```json
{
  "version": "0.3.1",
  "notes": "Short user-facing release summary.",
  "url": "/api/motion-plug/download",
  "sha256": "64-lowercase-hex-characters"
}
```

Publishing is one command in the website repo — it uploads the artifacts to the
private `software` bucket and flips the `releases` row, with no redeploy:

```sh
npm run motion-release:publish -- ../MotionPlug/release "what changed"
```

`url` is relative and the panel resolves it against the manifest's own URL. It
points at `/api/motion-plug/download`, which 302s to a freshly signed storage
URL at download time, so the address never expires while an update prompt sits
open. `?platform=mac` and `?platform=win` serve the installers.

What the publish script guarantees:

- The artifacts upload before the `releases` row moves, so a panel never sees a release whose payload is absent.
- The digest stored in the row is computed from the uploaded bytes, not copied by hand.
- A release row without a valid digest is reported as "no update" rather than offered, because the panel rejects an unverifiable archive before extracting it.
- The installers are linked for first-time installs; the in-panel updater always consumes the canonical ZIP.

For local feed testing, run an HTTP server and set this once in the CEP developer console:

```js
localStorage.setItem("motionplug.updateManifestUrl", "http://localhost:4173/latest.json");
```

Only localhost may use plain HTTP. Remove the override afterward.

## Tagged CI release

1. Update `RELEASE-vX.Y.Z.md`.
2. Run `npm run version:set -- X.Y.Z` and commit the synchronized files.
3. Tag that commit `vX.Y.Z` and push the tag.
4. `.github/workflows/build-installers.yml` builds clean macOS and Windows artifacts and places them in a draft GitHub release.
5. Sign/notarize as described in [SIGNING.md](SIGNING.md), upload the final artifacts, publish the ZIP, and then publish `latest.json` at the public update endpoint.
6. Install both native packages on clean user accounts, open Premiere, and run one Add/Update round trip before publishing the draft release.

The workflow can also be run manually; those artifacts expire after one day and do not create a public release.

## Update safety

The updater checks at launch and every 30 minutes while the panel is open. Manual checks bypass that throttle. It never sends credentials or machine identity.

An update is downloaded to the OS temporary directory, size-limited, SHA-256 verified, extracted, and validated for Motion Plug's extension ID, synchronized version metadata, runtime sentinels, local HTML/CSS references, and catalog media. A complete sibling directory is prepared before the live install moves. Failed swaps restore the old directory; settings remain outside the extension folder. Premiere must restart before the new JavaScript loads.
