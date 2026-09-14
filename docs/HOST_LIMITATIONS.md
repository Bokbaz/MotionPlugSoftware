# Host limitations

- Motion Plug uses an explicit **Add to timeline** action. It does not simulate direct dragging from a panel into Premiere’s timeline.
- The inserted graphic is an alpha PNG sequence, not a MOGRT. Its text and motion controls remain editable through **Update selected** in Motion Plug, not Premiere’s Properties panel.
- Optional sound is a separate WAV so it can be moved, trimmed, mixed, or removed independently. Premiere scripting does not provide a dependable cross-version clip-linking operation, so the video and SFX are selected together after insertion but are not promised to stay linked.
- Updating through Motion Plug regenerates the animation and recalculates cue timing. Trimming, slipping, or retiming either clip directly in Premiere does not regenerate or resynchronize the other.
- Add validates current lock state and occupied ranges before using `overwriteClip`. Track creation relies on Premiere’s undocumented QE DOM only when no suitable existing track is available. If QE is unavailable, Motion Plug refuses the edit instead of overwriting media.
- CEP host changes cannot be wrapped in the same documented transaction API available to modern UXP. Add performs compensating cleanup after a partial failure, and Update attempts to restore the previous clips. Verify Premiere’s actual Undo behavior before distribution.
- Frame size follows the active sequence automatically. Existing graphics must be updated through Motion Plug after changing the sequence frame size to regenerate their media at the new dimensions.
- Product Callout presets expose manual anchor and label positions. They do not track footage automatically.
- Saved projects receive durable generated media beside the project. Unsaved projects fall back to `Documents/Motion Plug Media` and display a warning.
- A genuine editable MOGRT authoring/export workflow requires After Effects source compositions. None are present, so no `.mogrt` is claimed or shipped.
- The CEP manifest declares Premiere Pro 2020 and newer, matching the reference extension architecture. Only versions recorded in the compatibility report should be described as tested.
