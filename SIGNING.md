# Signing Motion Plug installers

The installers work unsigned for early testing, but downloaded builds show the operating system's normal unknown-publisher warning. Signing is strongly recommended before broad public distribution.

## macOS

Enroll in the Apple Developer Program and create a **Developer ID Installer** certificate. Store notarization credentials once:

```sh
xcrun notarytool store-credentials motionplug \
  --apple-id you@example.com --team-id YOURTEAMID
```

Build, sign, notarize, and staple in one run:

```sh
MP_TARGET_PLATFORM=mac-universal \
MP_MAC_INSTALLER_IDENTITY="Developer ID Installer: Your Name (YOURTEAMID)" \
MP_NOTARY_PROFILE=motionplug \
npm run release
```

Motion Plug has no nested native executable, so only the installer package needs a Developer ID signature.

## Windows

Use an Authenticode certificate or trusted cloud-signing provider. The release script exposes a credential-free hook; no certificate or secret belongs in this repository:

```powershell
$env:MP_TARGET_PLATFORM = "win-x64"
$env:MP_WINDOWS_SIGNTOOL = "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
$env:MP_WINDOWS_CERT_SUBJECT = "Your Company"
$env:MP_WINDOWS_TIMESTAMP_URL = "http://timestamp.digicert.com"
bash build-release.sh
```

The script signs the finished installer and verifies the signature. Timestamping keeps the signature valid after the certificate expires.
