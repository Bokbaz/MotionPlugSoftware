import { createSoundtrack, planSoundCues } from "../audio/matched-sfx";
import { computeDuration, presetById, valuesForPreset } from "../catalog/presets";
import type {
  MotionPlugInstance,
  PresetValues,
  RenderConfig,
  UserPreferences,
} from "../catalog/types";
import type { RenderProgress } from "../render/render-client";
import { RenderClient } from "../render/render-client";
import {
  prepareDestination,
  removeCreatedVersion,
  resolveMediaDestination,
  writeBinary,
  writeText,
} from "./filesystem";
import {
  getSelectedInstance,
  getTimelineContext,
  insertRenderedMedia,
  replaceSelectedMedia,
  type InsertResult,
  type SelectedInstance,
  type TimelineContext,
} from "./host";

export interface WorkflowProgress extends RenderProgress {
  stage: "rendering" | "importing";
}

export interface WorkflowInput {
  presetId: string;
  values: PresetValues;
  preferences: UserPreferences;
  onProgress?: (progress: WorkflowProgress) => void;
}

export interface WorkflowResult extends InsertResult {
  warnings: string[];
  mediaFolder: string;
}

function id(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }
}


function renderConfig(
  presetId: string,
  values: PresetValues,
  dimensions: { width: number; height: number },
  duration: number,
): RenderConfig {
  return {
    presetId,
    values,
    width: dimensions.width,
    height: dimensions.height,
    duration,
    background: "transparent",
    renderMode: "export",
  };
}

export class MotionPlugWorkflow {
  private busy = false;

  constructor(private readonly renderer: RenderClient) {}

  isBusy(): boolean { return this.busy; }

  private async renderAssets(
    input: WorkflowInput,
    context: TimelineContext,
    instanceId: string,
    renderVersion: number,
  ): Promise<{
    instance: MotionPlugInstance;
    destination: Awaited<ReturnType<typeof resolveMediaDestination>>;
    warnings: string[];
  }> {
    const preset = presetById.get(input.presetId);
    if (!preset) throw new Error("The selected preset is no longer installed.");
    const values = valuesForPreset(input.presetId, input.values);
    const duration = Math.ceil(computeDuration(values, preset.duration) * context.fps) / context.fps;
    const dimensions = { width: context.width, height: context.height };
    const destination = await resolveMediaDestination(
      context.projectPath,
      context.projectName,
      instanceId,
      renderVersion,
    );
    await prepareDestination(destination);
    const now = new Date().toISOString();
    const instance: MotionPlugInstance = {
      schemaVersion: 1,
      instanceId,
      presetId: preset.id,
      presetVersion: preset.version,
      values,
      duration,
      fps: context.fps,
      width: dimensions.width,
      height: dimensions.height,
      videoTrackIndex: 0,
      renderVersion,
      videoPath: destination.firstFramePath,
      audioPath: undefined,
      createdAt: now,
      updatedAt: now,
    };
    const warnings = [destination.warning].filter((value): value is string => Boolean(value));
    try {
      const rendered = await this.renderer.render(
        renderConfig(preset.id, values, dimensions, duration),
        context.fps,
        destination.framesFolder,
        (progress) => input.onProgress?.({ ...progress, stage: "rendering" }),
      );
      warnings.push(...rendered.warnings);
      if (Boolean(values.sfxEnabled ?? input.preferences.sfxEnabled)) {
        const wav = await createSoundtrack(preset, values, duration, Number(values.sfxVolume ?? input.preferences.sfxVolume));
        await writeBinary(destination.audioPath, wav);
        instance.audioPath = destination.audioPath;
      }
      await writeText(destination.metadataPath, JSON.stringify({
        format: "Motion Plug Render Source",
        generatedAt: now,
        status: "rendered",
        instance,
        preset,
        sfxCues: planSoundCues(preset, values, duration),
      }, null, 2));
      return { instance, destination, warnings };
    } catch (error) {
      await removeCreatedVersion(destination);
      throw error;
    }
  }

  async add(input: WorkflowInput): Promise<WorkflowResult> {
    if (this.busy) throw new Error("Motion Plug is already rendering another graphic.");
    this.busy = true;
    try {
      const context = await getTimelineContext();
      const preset = presetById.get(input.presetId);
      if (!preset) throw new Error("The selected preset is missing.");
      const rendered = await this.renderAssets(input, context, id(), 1);
      input.onProgress?.({ frame: 1, total: 1, ratio: 1, stage: "importing" });
      try {
        const inserted = await insertRenderedMedia({
          context,
          instance: rendered.instance,
          firstFramePath: rendered.destination.firstFramePath,
          audioPath: rendered.instance.audioPath,
          preferences: input.preferences,
        }, preset.name);
        await writeText(rendered.destination.metadataPath, JSON.stringify({
          format: "Motion Plug Render Source",
          generatedAt: rendered.instance.createdAt,
          status: "inserted",
          instance: inserted.instance,
          preset,
          sfxCues: planSoundCues(preset, rendered.instance.values, rendered.instance.duration),
        }, null, 2));
        return {
          ...inserted,
          warnings: [...rendered.warnings, inserted.warning].filter((value): value is string => Boolean(value)),
          mediaFolder: rendered.destination.versionFolder,
        };
      } catch (error) {
        await writeText(rendered.destination.metadataPath, JSON.stringify({
          format: "Motion Plug Render Source",
          status: "rendered-not-inserted",
          reason: error instanceof Error ? error.message : String(error),
          instance: rendered.instance,
          preset,
        }, null, 2));
        throw error;
      }
    } finally {
      this.busy = false;
    }
  }

  async selected(): Promise<SelectedInstance> {
    return getSelectedInstance();
  }

  async update(input: WorkflowInput, selected?: SelectedInstance): Promise<WorkflowResult> {
    if (this.busy) throw new Error("Motion Plug is already rendering another graphic.");
    this.busy = true;
    try {
      const source = selected ?? await getSelectedInstance();
      const preset = presetById.get(input.presetId);
      if (!preset) throw new Error("The selected preset is missing.");
      const rendered = await this.renderAssets(
        input,
        source.context,
        source.instance.instanceId,
        source.instance.renderVersion + 1,
      );
      rendered.instance.createdAt = source.instance.createdAt;
      rendered.instance.updatedAt = new Date().toISOString();
      input.onProgress?.({ frame: 1, total: 1, ratio: 1, stage: "importing" });
      try {
        const replaced = await replaceSelectedMedia({
          selected: source,
          next: rendered.instance,
          firstFramePath: rendered.destination.firstFramePath,
          audioPath: rendered.instance.audioPath,
          preferences: input.preferences,
          title: preset.name,
        });
        await writeText(rendered.destination.metadataPath, JSON.stringify({
          format: "Motion Plug Render Source",
          status: "inserted-update",
          instance: replaced.instance,
          preset,
          sfxCues: planSoundCues(preset, rendered.instance.values, rendered.instance.duration),
        }, null, 2));
        return {
          ...replaced,
          warnings: [...rendered.warnings, replaced.warning].filter((value): value is string => Boolean(value)),
          mediaFolder: rendered.destination.versionFolder,
        };
      } catch (error) {
        await writeText(rendered.destination.metadataPath, JSON.stringify({
          format: "Motion Plug Render Source",
          status: "rendered-update-not-inserted",
          reason: error instanceof Error ? error.message : String(error),
          instance: rendered.instance,
          preset,
        }, null, 2));
        throw error;
      }
    } finally {
      this.busy = false;
    }
  }
}
