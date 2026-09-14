export interface Hsv { h: number; s: number; v: number }
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

// An in-panel picker keeps color editing usable in CEP hosts without native color dialogs.
let close: (() => void) | undefined;
export function closeColorPicker(): void { close?.(); close = undefined; }

export function bindColorPickers(): void {
  closeColorPicker();
  document.querySelectorAll<HTMLInputElement>("[data-color-picker]").forEach((swatch) => {
    swatch.addEventListener("click", (event) => {
      event.preventDefault();
      const wasOpen = swatch.getAttribute("aria-expanded") === "true";
      close?.();
      if (wasOpen) return;
      const control = swatch.dataset.colorPicker!;
      const input = document.querySelector<HTMLInputElement>(`[data-control="${control}"]`)!;
      let color = hexToHsv(input.value);
      const editor = document.createElement("div");
      editor.className = "color-editor field--wide";
      editor.innerHTML = '<div class="color-editor__heading"><strong></strong><button type="button" class="quiet-button">Done</button></div><canvas width="280" height="128" tabindex="0" role="slider" aria-label="Saturation and brightness. Left and right adjust saturation; up and down adjust brightness." aria-valuemin="0" aria-valuemax="100"></canvas><label class="field field--range"><span>Hue</span><input type="range" min="0" max="359" step="1" aria-label="Color hue" /></label>';
      editor.querySelector("strong")!.textContent = input.closest("label")?.querySelector("span")?.textContent ?? "Color";
      const canvas = editor.querySelector("canvas")!;
      const context = canvas.getContext("2d")!;
      const hue = editor.querySelector("input")!;
      let dragging = false;
      function paint(): void {
        context.fillStyle = hsvToHex({ h: color.h, s: 1, v: 1 });
        context.fillRect(0, 0, canvas.width, canvas.height);
        const saturation = context.createLinearGradient(0, 0, canvas.width, 0);
        saturation.addColorStop(0, "rgba(255,255,255,1)"); saturation.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = saturation; context.fillRect(0, 0, canvas.width, canvas.height);
        const brightness = context.createLinearGradient(0, 0, 0, canvas.height);
        brightness.addColorStop(0, "rgba(0,0,0,0)"); brightness.addColorStop(1, "rgba(0,0,0,1)");
        context.fillStyle = brightness; context.fillRect(0, 0, canvas.width, canvas.height);
        context.beginPath(); context.arc(color.s * canvas.width, (1 - color.v) * canvas.height, 5, 0, Math.PI * 2);
        context.strokeStyle = "#18191d"; context.lineWidth = 3; context.stroke();
        context.strokeStyle = "#f3f3ef"; context.lineWidth = 1.5; context.stroke();
        hue.value = String(Math.round(color.h));
        canvas.setAttribute("aria-valuenow", String(Math.round(color.s * 100)));
        canvas.setAttribute("aria-valuetext", `${Math.round(color.s * 100)}% saturation, ${Math.round(color.v * 100)}% brightness`);
      }
      function change(): void {
        input.value = hsvToHex(color);
        swatch.value = input.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        paint();
      }
      function move(event: MouseEvent): void {
        if (!dragging) return;
        if (!editor.isConnected) { close?.(); return; }
        const rect = canvas.getBoundingClientRect();
        color.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        color.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        change();
      }
      const up = () => { dragging = false; };
      canvas.addEventListener("mousedown", (event) => { event.preventDefault(); dragging = true; canvas.focus(); move(event); });
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      const sync = () => { if (/^#[0-9a-f]{6}$/i.test(input.value)) { color = hexToHsv(input.value); paint(); } };
      input.addEventListener("change", sync);
      canvas.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === "ArrowLeft") color.s -= step;
        else if (event.key === "ArrowRight") color.s += step;
        else if (event.key === "ArrowUp") color.v += step;
        else if (event.key === "ArrowDown") color.v -= step;
        else return;
        event.preventDefault(); color.s = Math.max(0, Math.min(1, color.s)); color.v = Math.max(0, Math.min(1, color.v)); change();
      });
      hue.addEventListener("input", () => { color.h = Number(hue.value); change(); });
      close = () => {
        editor.remove(); swatch.setAttribute("aria-expanded", "false");
        window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); input.removeEventListener("change", sync);
      };
      editor.querySelector("button")!.addEventListener("click", () => { close?.(); swatch.focus(); });
      editor.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); close?.(); swatch.focus(); } });
      swatch.setAttribute("aria-expanded", "true");
      swatch.closest(".field")!.insertAdjacentElement("afterend", editor);
      paint();
      editor.scrollIntoView({ block: "nearest" });
      canvas.focus({ preventScroll: true });
    });
  });
}
