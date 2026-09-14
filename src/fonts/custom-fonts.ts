import type { PresetValues } from "../catalog/types";

export interface CustomFont { family: string; name: string; data: string }
const loaded = new Map<string, Promise<void>>();

export function validFontSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && (
    (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
    || String.fromCharCode(...bytes.slice(0, 4)) === "OTTO"
    || String.fromCharCode(...bytes.slice(0, 4)) === "true"
  );
}

export async function loadCustomFont(values: PresetValues): Promise<void> {
  const family = String(values.fontFamily ?? "");
  if (!family.startsWith("MotionPlugCustom-")) return;
  const data = String(values.fontData ?? "");
  if (!/^data:font\/(ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(data)) {
    throw new Error("This custom font is missing. Import its OTF or TTF file again in Typography & color.");
  }
  if (!loaded.has(family)) {
    loaded.set(family, (async () => {
      try {
        const face = new FontFace(family, `url(${data})`);
        await face.load();
        document.fonts.add(face);
      } catch {
        loaded.delete(family);
        throw new Error("This font could not be loaded. Choose a valid OTF or TTF file.");
      }
    })());
  }
  await loaded.get(family);
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("motionplug-fonts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts", { keyPath: "family" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local font storage is unavailable."));
  });
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("fonts", "readonly");
    const request = transaction.objectStore("fonts").getAll();
    transaction.oncomplete = () => { db.close(); resolve(request.result as CustomFont[]); };
    transaction.onerror = () => { db.close(); reject(new Error("Could not read saved fonts.")); };
  });
}

export async function importCustomFont(file: File): Promise<CustomFont> {
  if (!/\.(otf|ttf)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose an OTF or TTF font smaller than 10 MB.");
  }
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Could not read this font file."));
    reader.readAsArrayBuffer(file);
  });
  const bytes = new Uint8Array(data);
  if (!validFontSignature(bytes)) throw new Error("This file is not a valid OTF or TTF font.");
  // A content-derived family avoids collisions between fonts with the same file name.
  let hash = 2166136261;
  let binary = "";
  for (const byte of bytes) { hash = Math.imul(hash ^ byte, 16777619); binary += String.fromCharCode(byte); }
  const font: CustomFont = {
    family: `MotionPlugCustom-${(hash >>> 0).toString(16)}-${bytes.length}`,
    name: file.name.replace(/\.(otf|ttf)$/i, ""),
    data: `data:font/${/\.otf$/i.test(file.name) ? "otf" : "ttf"};base64,${btoa(binary)}`,
  };
  await loadCustomFont({ fontFamily: font.family, fontData: font.data });
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("fonts", "readwrite");
    transaction.objectStore("fonts").put(font);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error("Could not save this font. Free local storage and import it again.")); };
  });
  return font;
}
