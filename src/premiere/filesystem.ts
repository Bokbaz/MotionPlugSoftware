declare const require: (id: string) => any;

export interface MediaDestination {
  root: string;
  versionFolder: string;
  framesFolder: string;
  firstFramePath: string;
  audioPath: string;
  metadataPath: string;
  durable: boolean;
  warning?: string;
}

function modules(): { fs: any; path: any; os: any } {
  const load = typeof window !== "undefined" && window.CSBridge?.require
    ? window.CSBridge.require
    : require;
  return {
    fs: load("fs"),
    path: load("path"),
    os: load("os"),
  };
}

function safeSegment(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
}

export async function resolveMediaDestination(
  projectPath: string,
  projectName: string,
  instanceId: string,
  renderVersion: number,
): Promise<MediaDestination> {
  const { path, os } = modules();
  let root: string;
  let durable = Boolean(projectPath);
  let warning: string | undefined;
  if (projectPath) {
    const projectFolder = path.dirname(projectPath);
    const projectStem = safeSegment(path.basename(projectPath, path.extname(projectPath)) || projectName);
    root = path.join(projectFolder, "Motion Plug Media", projectStem);
  } else {
    root = path.join(os.homedir(), "Documents", "Motion Plug Media", safeSegment(projectName));
    durable = false;
    warning = "This project has not been saved. Media was placed in Documents/Motion Plug Media; save the project before building a final edit.";
  }
  const versionFolder = path.join(root, safeSegment(instanceId), `v${Math.max(1, Math.floor(renderVersion))}`);
  const framesFolder = path.join(versionFolder, "frames");
  return {
    root,
    versionFolder,
    framesFolder,
    firstFramePath: path.join(framesFolder, "frame_000000.png"),
    audioPath: path.join(versionFolder, "motion-plug-sfx.wav"),
    metadataPath: path.join(versionFolder, "motion-plug.json"),
    durable,
    warning,
  };
}

export async function prepareDestination(destination: MediaDestination): Promise<void> {
  const { fs } = modules();
  if (fs.promises?.mkdir) await fs.promises.mkdir(destination.framesFolder, { recursive: true });
  else fs.mkdirSync(destination.framesFolder, { recursive: true });
}

export async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  const { fs } = modules();
  const payload = typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes;
  if (fs.promises?.writeFile) await fs.promises.writeFile(path, payload);
  else fs.writeFileSync(path, payload);
}

export async function writeText(path: string, content: string): Promise<void> {
  const { fs } = modules();
  if (fs.promises?.writeFile) await fs.promises.writeFile(path, content, { encoding: "utf-8" });
  else fs.writeFileSync(path, content, { encoding: "utf-8" });
}

export async function removeCreatedVersion(destination: MediaDestination): Promise<void> {
  const { fs } = modules();
  try {
    if (fs.promises?.rm) await fs.promises.rm(destination.versionFolder, { recursive: true, force: true });
    else if (fs.rmSync) fs.rmSync(destination.versionFolder, { recursive: true, force: true });
    else if (fs.existsSync(destination.versionFolder)) fs.rmdirSync(destination.versionFolder, { recursive: true });
  } catch {
    // A failed render may have no folder yet, or Premiere may already hold a file handle.
  }
}

export function framePath(folder: string, index: number): string {
  const { path } = modules();
  return path.join(folder, `frame_${Math.max(0, index).toString().padStart(6, "0")}.png`);
}

export function decodeDataUrl(dataUrl: string): Uint8Array {
  const separator = dataUrl.indexOf(",");
  if (separator < 0 || !dataUrl.slice(0, separator).includes(";base64")) {
    throw new Error("Renderer returned an invalid PNG data URL.");
  }
  const binary = atob(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
