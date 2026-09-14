/* Motion Plug Premiere host bridge.
 * Runs in ExtendScript through the CEP manifest's ScriptPath. Keep this file
 * ES3-compatible because older Premiere releases use the legacy JS engine. */

var MP_TICKS_PER_SECOND = 254016000000;

function MP_jsonQuote(value) {
    var text = String(value);
    var quoted = '"';
    for (var i = 0; i < text.length; i++) {
        var character = text.charAt(i);
        var code = text.charCodeAt(i);
        if (character === '"') quoted += '\\"';
        else if (character === '\\') quoted += '\\\\';
        else if (character === '\b') quoted += '\\b';
        else if (character === '\f') quoted += '\\f';
        else if (character === '\n') quoted += '\\n';
        else if (character === '\r') quoted += '\\r';
        else if (character === '\t') quoted += '\\t';
        else if (code < 32 || code === 0x2028 || code === 0x2029) {
            var hex = code.toString(16);
            while (hex.length < 4) hex = '0' + hex;
            quoted += '\\u' + hex;
        } else quoted += character;
    }
    return quoted + '"';
}

function MP_jsonSerialize(value, stack) {
    if (value === null) return 'null';
    var kind = typeof value;
    if (kind === 'string') return MP_jsonQuote(value);
    if (kind === 'number') return isFinite(value) ? String(value) : 'null';
    if (kind === 'boolean') return value ? 'true' : 'false';
    if (kind !== 'object') return undefined;

    for (var s = 0; s < stack.length; s++) {
        if (stack[s] === value) throw new Error('Cannot serialize a circular value.');
    }
    stack.push(value);

    var parts = [];
    var isArray = Object.prototype.toString.call(value) === '[object Array]';
    if (isArray) {
        for (var i = 0; i < value.length; i++) {
            var item = MP_jsonSerialize(value[i], stack);
            parts.push(item === undefined ? 'null' : item);
        }
        stack.pop();
        return '[' + parts.join(',') + ']';
    }

    for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        var serialized = MP_jsonSerialize(value[key], stack);
        if (serialized !== undefined) parts.push(MP_jsonQuote(key) + ':' + serialized);
    }
    stack.pop();
    return '{' + parts.join(',') + '}';
}

function MP_jsonStringify(value) {
    if (typeof JSON !== 'undefined' && JSON && typeof JSON.stringify === 'function') {
        return JSON.stringify(value);
    }
    return MP_jsonSerialize(value, []);
}

function MP_jsonParse(value) {
    var source = String(value);
    if (typeof JSON !== 'undefined' && JSON && typeof JSON.parse === 'function') {
        return JSON.parse(source);
    }
    // Payloads originate in Motion Plug and are URI-encoded before they cross
    // the CEP bridge. Escaping these separators keeps JSON strings valid when
    // parsed by legacy ExtendScript's JavaScript evaluator.
    source = source.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return eval('(' + source + ')');
}

function MP_ok(value) {
    try { return 'OK|' + encodeURIComponent(MP_jsonStringify(value)); }
    catch (e) { return 'ERR|Could not serialize the Premiere response: ' + e.toString(); }
}

function MP_error(error) {
    var message = error && error.message ? error.message : String(error);
    return 'ERR|' + message;
}

function MP_payload(encoded) {
    if (!encoded) return {};
    return MP_jsonParse(decodeURIComponent(String(encoded)));
}

function MP_norm(path) {
    return String(path || '').replace(/\\/g, '/').toLowerCase();
}

function MP_sequenceId(sequence) {
    try {
        if (sequence.sequenceID !== undefined && sequence.sequenceID !== null) {
            return String(sequence.sequenceID);
        }
    } catch (ignoreId) {}
    try { return String(sequence.id); } catch (ignoreLegacyId) {}
    return String(sequence.name || 'sequence') + ':' + String(sequence.timebase || '');
}

function MP_expectedSequence(sequence, expectedId) {
    return !expectedId || MP_sequenceId(sequence) === String(expectedId);
}

function MP_nodeId(item) {
    try {
        if (item.nodeId !== undefined && item.nodeId !== null) return String(item.nodeId);
    } catch (ignoreNode) {}
    try {
        if (item.projectItem && item.projectItem.nodeId !== undefined) {
            return String(item.projectItem.nodeId) + ':' + String(item.start.ticks);
        }
    } catch (ignoreProjectNode) {}
    try { return 'media:' + MP_norm(MP_mediaPath(item)) + ':' + String(item.start.ticks); }
    catch (ignoreFallback) { return ''; }
}

function MP_mediaPath(item) {
    try {
        if (item && item.projectItem && item.projectItem.getMediaPath) {
            return String(item.projectItem.getMediaPath() || '');
        }
    } catch (ignorePath) {}
    return '';
}

function MP_isMotionPlugMedia(path) {
    if (!path) return false;
    try {
        var frame = new File(path);
        if (!frame.parent || !frame.parent.parent) return false;
        return new File(frame.parent.parent.fsName + '/motion-plug.json').exists;
    } catch (ignoreMetadata) { return false; }
}

function MP_trackLocked(track) {
    try { return !!(track.isLocked && track.isLocked()); }
    catch (ignoreLocked) { return false; }
}

function MP_clipOverlaps(clip, startSeconds, endSeconds, ignoredNodeId) {
    try {
        if (ignoredNodeId && MP_nodeId(clip) === String(ignoredNodeId)) return false;
        return Number(clip.end.seconds) > startSeconds + 0.000001 &&
               Number(clip.start.seconds) < endSeconds - 0.000001;
    } catch (ignoreClip) { return true; }
}

function MP_trackFree(track, startSeconds, endSeconds, ignoredNodeId) {
    if (!track || MP_trackLocked(track)) return false;
    for (var i = 0; i < track.clips.numItems; i++) {
        if (MP_clipOverlaps(track.clips[i], startSeconds, endSeconds, ignoredNodeId)) return false;
    }
    return true;
}

function MP_findOrCreateBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var child = root.children[i];
        if (child.name === name && child.type === ProjectItemType.BIN) return child;
    }
    return root.createBin(name);
}

function MP_findProjectItemByPath(bin, path) {
    var wanted = MP_norm(path);
    for (var i = bin.children.numItems - 1; i >= 0; i--) {
        var item = bin.children[i];
        if (item.type === ProjectItemType.BIN) continue;
        try {
            if (MP_norm(item.getMediaPath()) === wanted) return item;
        } catch (ignorePath) {}
    }
    return null;
}

function MP_importMedia(bin, path, numberedStills, fps, frames, label) {
    var file = new File(path);
    if (!file.exists) throw new Error('Rendered media is missing: ' + path);
    var existing = MP_findProjectItemByPath(bin, path);
    var item = existing;
    if (!item) {
        var before = bin.children.numItems;
        var imported = app.project.importFiles([path], true, bin, !!numberedStills);
        if (!imported) throw new Error('Premiere could not import ' + (numberedStills ? 'the animation.' : 'the sound effect.'));
        item = MP_findProjectItemByPath(bin, path);
        if (!item && bin.children.numItems > before) item = bin.children[bin.children.numItems - 1];
    }
    if (!item) throw new Error('Premiere imported the media but did not expose its project item.');
    if (numberedStills) {
        try { if (item.setOverrideFrameRate) item.setOverrideFrameRate(fps); }
        catch (ignoreRate) {}
        if (item.setOutPoint) {
            try { item.setOutPoint(Math.max(1, Math.round(frames)) / fps, 1); }
            catch (durationError) { throw new Error('Premiere could not set the animation duration.'); }
        }
    }
    try { item.name = label; } catch (ignoreName) {}
    return item;
}

function MP_addVideoTrack(sequence) {
    var before = sequence.videoTracks.numTracks;
    try {
        app.enableQE();
        var qeSequence = qe.project.getActiveSequence();
        qeSequence.addTracks(1, before, 0);
    } catch (firstError) {
        try {
            app.enableQE();
            qe.project.getActiveSequence().addTracks(1);
        } catch (ignoreSecond) {}
    }
    return sequence.videoTracks.numTracks > before ? sequence.videoTracks.numTracks - 1 : -1;
}

function MP_addAudioTrack(sequence) {
    var before = sequence.audioTracks.numTracks;
    try {
        app.enableQE();
        var qeSequence = qe.project.getActiveSequence();
        qeSequence.addTracks(0, 0, 1, 1, before, 0, 1);
    } catch (firstError) {
        try {
            app.enableQE();
            qe.project.getActiveSequence().addTracks(0, 0, 1);
        } catch (ignoreSecond) {}
    }
    if (sequence.audioTracks.numTracks <= before) return -1;
    for (var i = sequence.audioTracks.numTracks - 1; i >= 0; i--) {
        if (sequence.audioTracks[i].clips.numItems === 0) return i;
    }
    return sequence.audioTracks.numTracks - 1;
}

function MP_ensureVideoTrack(sequence, index) {
    var guard = 0;
    while (sequence.videoTracks.numTracks <= index && guard < 32) {
        if (MP_addVideoTrack(sequence) < 0) return false;
        guard++;
    }
    return sequence.videoTracks.numTracks > index;
}

function MP_ensureAudioTrack(sequence, index) {
    var guard = 0;
    while (sequence.audioTracks.numTracks <= index && guard < 32) {
        if (MP_addAudioTrack(sequence) < 0) return false;
        guard++;
    }
    return sequence.audioTracks.numTracks > index;
}

function MP_resolveVideoTrack(sequence, policy, requested, startSeconds, endSeconds, ignoredNodeId) {
    var index = Math.max(0, Math.floor(Number(requested) || 0));
    if (policy === 'specific') {
        if (!MP_ensureVideoTrack(sequence, index)) throw new Error('Premiere could not create V' + (index + 1) + '.');
        if (MP_trackLocked(sequence.videoTracks[index])) throw new Error('V' + (index + 1) + ' is locked.');
        if (!MP_trackFree(sequence.videoTracks[index], startSeconds, endSeconds, ignoredNodeId)) {
            throw new Error('V' + (index + 1) + ' already contains media at the target time. Nothing was overwritten.');
        }
        return index;
    }

    var highestOccupied = -1;
    var t;
    for (t = 0; t < sequence.videoTracks.numTracks; t++) {
        var track = sequence.videoTracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
            if (MP_clipOverlaps(track.clips[c], startSeconds, endSeconds, ignoredNodeId)) {
                highestOccupied = t;
                break;
            }
        }
    }
    for (t = highestOccupied + 1; t < sequence.videoTracks.numTracks; t++) {
        if (MP_trackFree(sequence.videoTracks[t], startSeconds, endSeconds, ignoredNodeId)) return t;
    }
    for (t = 0; t < sequence.videoTracks.numTracks; t++) {
        if (MP_trackFree(sequence.videoTracks[t], startSeconds, endSeconds, ignoredNodeId)) return t;
    }
    index = MP_addVideoTrack(sequence);
    if (index < 0) throw new Error('No unlocked video track is free, and Premiere could not create another one.');
    return index;
}

function MP_resolveAudioTrack(sequence, policy, requested, startSeconds, endSeconds, ignoredNodeId) {
    var index = Math.max(0, Math.floor(Number(requested) || 0));
    if (policy === 'specific') {
        if (!MP_ensureAudioTrack(sequence, index)) throw new Error('Premiere could not create A' + (index + 1) + '.');
        if (MP_trackLocked(sequence.audioTracks[index])) throw new Error('A' + (index + 1) + ' is locked.');
        if (!MP_trackFree(sequence.audioTracks[index], startSeconds, endSeconds, ignoredNodeId)) {
            throw new Error('A' + (index + 1) + ' already contains media at the target time. Nothing was overwritten.');
        }
        return index;
    }
    for (var t = 0; t < sequence.audioTracks.numTracks; t++) {
        if (MP_trackFree(sequence.audioTracks[t], startSeconds, endSeconds, ignoredNodeId)) return t;
    }
    index = MP_addAudioTrack(sequence);
    if (index < 0) throw new Error('No unlocked audio track is free, and Premiere could not create another one.');
    return index;
}

function MP_overwriteAtFrame(sequence, track, projectItem, startFrame) {
    var ticks = Math.round(Number(startFrame) * Number(sequence.timebase));
    return track.overwriteClip(projectItem, String(ticks));
}

function MP_findClip(track, path, startFrame, fps, nodeId) {
    if (!track) return null;
    var wantedPath = MP_norm(path);
    var wantedStart = Number(startFrame) / fps;
    var tolerance = 0.45 / fps;
    for (var i = track.clips.numItems - 1; i >= 0; i--) {
        var clip = track.clips[i];
        if (nodeId && MP_nodeId(clip) === String(nodeId)) return clip;
        if (Math.abs(Number(clip.start.seconds) - wantedStart) > tolerance) continue;
        if (!wantedPath || MP_norm(MP_mediaPath(clip)) === wantedPath) return clip;
    }
    return null;
}

function MP_trimClip(sequence, track, projectItem, startFrame, frames, fps) {
    var path = '';
    try { path = String(projectItem.getMediaPath() || ''); } catch (ignorePath) {}
    var clip = MP_findClip(track, path, startFrame, fps, '');
    if (!clip) return null;
    var endFrame = Number(startFrame) + Math.max(1, Math.round(Number(frames) || 1));
    var wantedEnd = endFrame / fps;
    if (Math.abs(Number(clip.end.seconds) - wantedEnd) > (0.45 / fps)) {
        var time = new Time();
        try { time.ticks = String(Math.round(endFrame * Number(sequence.timebase))); }
        catch (ignoreTicks) { time.seconds = wantedEnd; }
        clip.end = time;
    }
    return clip;
}

function MP_removeClip(clip) {
    if (!clip || !clip.remove) return false;
    try { return clip.remove(false, true) !== false; }
    catch (ignoreRemove) { return false; }
}

function MP_clearSelection(sequence) {
    var t, c;
    try {
        for (t = 0; t < sequence.videoTracks.numTracks; t++) {
            for (c = 0; c < sequence.videoTracks[t].clips.numItems; c++) {
                sequence.videoTracks[t].clips[c].setSelected(0, 0);
            }
        }
        for (t = 0; t < sequence.audioTracks.numTracks; t++) {
            for (c = 0; c < sequence.audioTracks[t].clips.numItems; c++) {
                sequence.audioTracks[t].clips[c].setSelected(0, 0);
            }
        }
    } catch (ignoreSelection) {}
}

function MP_selectInserted(sequence, videoClip, audioClip) {
    try {
        MP_clearSelection(sequence);
        if (videoClip && videoClip.setSelected) videoClip.setSelected(1, 0);
        if (audioClip && audioClip.setSelected) audioClip.setSelected(1, 1);
        else if (videoClip && videoClip.setSelected) videoClip.setSelected(1, 1);
    } catch (ignoreSelection) {}
}

function MP_label(item, value) {
    try { item.name = value; } catch (ignoreName) {}
}

function MP_timelineContext() {
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) return 'ERR|Open or create a sequence before adding a graphic.';
        var fps = MP_TICKS_PER_SECOND / Number(sequence.timebase);
        var player = sequence.getPlayerPosition();
        var frame = Math.round(Number(player.ticks) / Number(sequence.timebase));
        var projectPath = '';
        try { projectPath = String(app.project.path || ''); } catch (ignoreProjectPath) {}
        return 'OK|' + fps + '|' + sequence.frameSizeHorizontal + '|' + sequence.frameSizeVertical +
               '|' + frame + '|' + encodeURIComponent(MP_sequenceId(sequence)) +
               '|' + encodeURIComponent(projectPath) + '|' + encodeURIComponent(String(app.project.name || 'Untitled Project')) +
               '|' + encodeURIComponent(String(sequence.name || 'Untitled Sequence'));
    } catch (error) { return MP_error(error); }
}

function MP_selectedGraphic(encoded) {
    try {
        var payload = MP_payload(encoded);
        var sequence = app.project.activeSequence;
        if (!sequence) return 'ERR|Open a sequence, then select one Motion Plug graphic.';
        if (!MP_expectedSequence(sequence, payload.expectedSequenceId)) return 'ERR|SEQUENCE_CHANGED';
        var found = [];
        for (var t = 0; t < sequence.videoTracks.numTracks; t++) {
            var track = sequence.videoTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var selected = false;
                try { selected = !!clip.isSelected(); } catch (ignoreSelected) {
                    try { selected = !!clip.selected; } catch (ignoreLegacySelected) {}
                }
                if (!selected) continue;
                var path = MP_mediaPath(clip);
                if (!MP_isMotionPlugMedia(path)) continue;
                found.push({ clip: clip, path: path, trackIndex: t });
            }
        }
        if (!found.length) return 'ERR|Select one Motion Plug graphic clip in the timeline.';
        if (found.length > 1) return 'ERR|Select only one Motion Plug graphic to edit.';
        var match = found[0];
        var fps = MP_TICKS_PER_SECOND / Number(sequence.timebase);
        var startFrame = Math.round(Number(match.clip.start.ticks) / Number(sequence.timebase));
        var endFrame = Math.round(Number(match.clip.end.ticks) / Number(sequence.timebase));
        return MP_ok({
            nodeId: MP_nodeId(match.clip),
            videoPath: match.path,
            videoTrackIndex: match.trackIndex,
            startFrame: startFrame,
            startSeconds: startFrame / fps,
            endFrame: endFrame
        });
    } catch (error) { return MP_error(error); }
}

function MP_insertGraphic(encoded) {
    var videoClip = null;
    var audioClip = null;
    var videoItem = null;
    var audioItem = null;
    var sequence = null;
    var videoIndex = -1;
    var audioIndex = -1;
    var startFrame = 0;
    var fps = 0;
    try {
        var payload = MP_payload(encoded);
        sequence = app.project.activeSequence;
        if (!sequence) return 'ERR|Open or create a sequence before adding a graphic.';
        if (!MP_expectedSequence(sequence, payload.expectedSequenceId)) return 'ERR|SEQUENCE_CHANGED';
        fps = Number(payload.fps);
        startFrame = Math.round(Number(payload.startFrame));
        var frames = Math.max(1, Math.round(Number(payload.frames)));
        if (!isFinite(fps) || fps <= 0 || !isFinite(startFrame) || startFrame < 0) {
            return 'ERR|The insertion time or sequence frame rate is invalid.';
        }
        var startSeconds = startFrame / fps;
        var endSeconds = (startFrame + frames) / fps;
        videoIndex = MP_resolveVideoTrack(
            sequence, payload.videoTrackPolicy, payload.videoTrackIndex,
            startSeconds, endSeconds, ''
        );
        if (payload.audioPath) {
            audioIndex = MP_resolveAudioTrack(
                sequence, payload.audioTrackPolicy, payload.audioTrackIndex,
                startSeconds, endSeconds, ''
            );
        }
        var bin = MP_findOrCreateBin('Motion Plug');
        var label = 'Motion Plug - ' + String(payload.title || 'Graphic') + ' [MP:' + String(payload.instanceId || '') + ']';
        videoItem = MP_importMedia(bin, payload.firstFramePath, true, fps, frames, label);
        if (payload.audioPath) audioItem = MP_importMedia(bin, payload.audioPath, false, fps, frames, label + ' - SFX');

        MP_overwriteAtFrame(sequence, sequence.videoTracks[videoIndex], videoItem, startFrame);
        videoClip = MP_trimClip(sequence, sequence.videoTracks[videoIndex], videoItem, startFrame, frames, fps);
        if (!videoClip) throw new Error('Premiere did not confirm the inserted animation.');
        MP_label(videoClip, label);

        if (audioItem) {
            MP_overwriteAtFrame(sequence, sequence.audioTracks[audioIndex], audioItem, startFrame);
            audioClip = MP_trimClip(sequence, sequence.audioTracks[audioIndex], audioItem, startFrame, frames, fps);
            if (!audioClip) throw new Error('Premiere inserted the animation but did not confirm its sound effect.');
            MP_label(audioClip, label + ' - SFX');
        }
        MP_selectInserted(sequence, videoClip, audioClip);
        var response = { videoTrackIndex: videoIndex };
        if (audioIndex >= 0) response.audioTrackIndex = audioIndex;
        return MP_ok(response);
    } catch (error) {
        if (!audioClip && audioItem && sequence && audioIndex >= 0) {
            audioClip = MP_findClip(sequence.audioTracks[audioIndex], MP_mediaPath({ projectItem: audioItem }), startFrame, fps, '');
        }
        if (!videoClip && videoItem && sequence && videoIndex >= 0) {
            videoClip = MP_findClip(sequence.videoTracks[videoIndex], MP_mediaPath({ projectItem: videoItem }), startFrame, fps, '');
        }
        if (audioClip) MP_removeClip(audioClip);
        if (videoClip) MP_removeClip(videoClip);
        return MP_error(error);
    }
}

function MP_replaceGraphic(encoded) {
    var newVideoClip = null;
    var newAudioClip = null;
    var oldVideo = null;
    var oldAudio = null;
    var oldVideoItem = null;
    var oldAudioItem = null;
    var oldVideoFrames = 1;
    var oldAudioFrames = 1;
    var removedOldVideo = false;
    var removedOldAudio = false;
    var sequence = null;
    var videoTrack = null;
    var oldAudioTrack = null;
    var newAudioTrack = null;
    var startFrame = 0;
    var fps = 0;
    var payload = null;
    var videoIndex = -1;
    var audioIndex = -1;
    var newVideoItem = null;
    var newAudioItem = null;
    try {
        payload = MP_payload(encoded);
        sequence = app.project.activeSequence;
        if (!sequence) return 'ERR|Open the sequence containing the Motion Plug graphic.';
        if (!MP_expectedSequence(sequence, payload.expectedSequenceId)) return 'ERR|SEQUENCE_CHANGED';
        fps = Number(payload.fps);
        startFrame = Math.round(Number(payload.startFrame));
        var frames = Math.max(1, Math.round(Number(payload.frames)));
        videoIndex = Math.max(0, Math.floor(Number(payload.oldVideoTrackIndex) || 0));
        if (videoIndex >= sequence.videoTracks.numTracks) return 'ERR|The original video track no longer exists.';
        videoTrack = sequence.videoTracks[videoIndex];
        if (MP_trackLocked(videoTrack)) return 'ERR|The original Motion Plug video track is locked.';
        oldVideo = MP_findClip(videoTrack, payload.oldFirstFramePath, startFrame, fps, payload.selectedNodeId);
        if (!oldVideo) return 'ERR|The selected graphic moved or changed while rendering. The original was left untouched.';
        oldVideoItem = oldVideo.projectItem;
        oldVideoFrames = Math.max(1, Math.round((Number(oldVideo.end.seconds) - Number(oldVideo.start.seconds)) * fps));
        var startSeconds = startFrame / fps;
        var endSeconds = (startFrame + frames) / fps;
        if (!MP_trackFree(videoTrack, startSeconds, endSeconds, MP_nodeId(oldVideo))) {
            return 'ERR|The updated duration would overlap another clip on V' + (videoIndex + 1) + '. Nothing was changed.';
        }

        var oldAudioIndex = Number(payload.oldAudioTrackIndex);
        if (payload.oldAudioPath && isFinite(oldAudioIndex) && oldAudioIndex >= 0 && oldAudioIndex < sequence.audioTracks.numTracks) {
            oldAudioTrack = sequence.audioTracks[oldAudioIndex];
            oldAudio = MP_findClip(oldAudioTrack, payload.oldAudioPath, startFrame, fps, '');
            if (oldAudio) {
                if (MP_trackLocked(oldAudioTrack)) return 'ERR|The original Motion Plug audio track is locked.';
                oldAudioItem = oldAudio.projectItem;
                oldAudioFrames = Math.max(1, Math.round((Number(oldAudio.end.seconds) - Number(oldAudio.start.seconds)) * fps));
            }
        }

        if (payload.audioPath) {
            if (oldAudio && MP_trackFree(oldAudioTrack, startSeconds, endSeconds, MP_nodeId(oldAudio))) {
                audioIndex = oldAudioIndex;
                newAudioTrack = oldAudioTrack;
            } else {
                audioIndex = MP_resolveAudioTrack(
                    sequence, payload.audioTrackPolicy, payload.audioTrackIndex,
                    startSeconds, endSeconds, oldAudio ? MP_nodeId(oldAudio) : ''
                );
                newAudioTrack = sequence.audioTracks[audioIndex];
            }
        }

        var bin = MP_findOrCreateBin('Motion Plug');
        var label = 'Motion Plug - ' + String(payload.title || 'Graphic') + ' [MP:' + String(payload.instanceId || '') + ']';
        newVideoItem = MP_importMedia(bin, payload.firstFramePath, true, fps, frames, label);
        if (payload.audioPath) newAudioItem = MP_importMedia(bin, payload.audioPath, false, fps, frames, label + ' - SFX');

        removedOldVideo = MP_removeClip(oldVideo);
        if (!removedOldVideo) throw new Error('Premiere could not remove the original animation.');
        if (oldAudio) {
            removedOldAudio = MP_removeClip(oldAudio);
            if (!removedOldAudio) throw new Error('Premiere could not remove the original sound effect.');
        }

        MP_overwriteAtFrame(sequence, videoTrack, newVideoItem, startFrame);
        newVideoClip = MP_trimClip(sequence, videoTrack, newVideoItem, startFrame, frames, fps);
        if (!newVideoClip) throw new Error('Premiere did not confirm the updated animation.');
        MP_label(newVideoClip, label);
        if (newAudioItem) {
            MP_overwriteAtFrame(sequence, newAudioTrack, newAudioItem, startFrame);
            newAudioClip = MP_trimClip(sequence, newAudioTrack, newAudioItem, startFrame, frames, fps);
            if (!newAudioClip) throw new Error('Premiere did not confirm the updated sound effect.');
            MP_label(newAudioClip, label + ' - SFX');
        }
        MP_selectInserted(sequence, newVideoClip, newAudioClip);
        var response = { videoTrackIndex: videoIndex };
        if (audioIndex >= 0) response.audioTrackIndex = audioIndex;
        return MP_ok(response);
    } catch (error) {
        if (!newAudioClip && newAudioItem && newAudioTrack && payload) {
            newAudioClip = MP_findClip(newAudioTrack, payload.audioPath, startFrame, fps, '');
        }
        if (!newVideoClip && newVideoItem && videoTrack && payload) {
            newVideoClip = MP_findClip(videoTrack, payload.firstFramePath, startFrame, fps, '');
        }
        if (newAudioClip) MP_removeClip(newAudioClip);
        if (newVideoClip) MP_removeClip(newVideoClip);
        var rollbackFailed = false;
        try {
            if (removedOldVideo && oldVideoItem && videoTrack) {
                MP_overwriteAtFrame(sequence, videoTrack, oldVideoItem, startFrame);
                if (!MP_trimClip(sequence, videoTrack, oldVideoItem, startFrame, oldVideoFrames, fps)) rollbackFailed = true;
            }
            if (removedOldAudio && oldAudioItem && oldAudioTrack) {
                MP_overwriteAtFrame(sequence, oldAudioTrack, oldAudioItem, startFrame);
                if (!MP_trimClip(sequence, oldAudioTrack, oldAudioItem, startFrame, oldAudioFrames, fps)) rollbackFailed = true;
            }
        } catch (rollbackError) { rollbackFailed = true; }
        return MP_error((error && error.message ? error.message : String(error)) +
            (rollbackFailed ? ' Automatic rollback was incomplete; the imported media remains in the Motion Plug bin for recovery.' : ' The original timeline media was restored.'));
    }
}
