# Motion Plug v0.3.1

First release published through the Caption Plug release pipeline.

- Points the in-panel update feed at `https://www.captionplug.com/api/motion-plug/latest`, the deployment that actually serves Motion Plug's pages and release storage. The previous default host answered every update check with a 404.
- Serves the update payload from the private release bucket through a redirect that is signed at download time, so an update prompt left open no longer expires before it is accepted.
- Publishes the release checksum alongside the payload, keeping the panel's existing SHA-256 verification intact end to end.
- Carries no preset, rendering, or interface changes from v0.3.0.
