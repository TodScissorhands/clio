export type PdfRecolorPresetId =
  | "original"
  | "zathura-dark"
  | "gruvbox-dark"
  | "solarized-dark"
  | "rose-pine-dawn"
  | "sepia-warm"
  | "custom";

export type PdfRecolorPreset = {
  id: PdfRecolorPresetId;
  label: string;
  lightColor: string; // page background
  darkColor: string;  // ink foreground
  recolor: boolean;
};

export type PdfRecolorSettings = {
  recolor: boolean;
  recolorLightcolor: string;
  recolorDarkcolor: string;
  recolorKeephue: boolean;
  recolorReverseVideo: boolean;
  recolorAdjustLightness: boolean;
  activePreset: PdfRecolorPresetId;
};

export type NormalizedRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const RECOLOR_WEIGHTS = [0.30, 0.59, 0.11] as const;

export const RECOLOR_PRESETS: Record<PdfRecolorPresetId, PdfRecolorPreset> = {
  original: {
    id: "original",
    label: "Original",
    lightColor: "#FFFFFF",
    darkColor: "#000000",
    recolor: false,
  },
  "zathura-dark": {
    id: "zathura-dark",
    label: "Zathura Dark",
    lightColor: "#14161B",
    darkColor: "#DCD7BA",
    recolor: true,
  },
  "gruvbox-dark": {
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    lightColor: "#282828",
    darkColor: "#EBDBB2",
    recolor: true,
  },
  "solarized-dark": {
    id: "solarized-dark",
    label: "Solarized Dark",
    lightColor: "#002B36",
    darkColor: "#839496",
    recolor: true,
  },
  "rose-pine-dawn": {
    id: "rose-pine-dawn",
    label: "Rose Pine Dawn",
    lightColor: "#FAF4ED",
    darkColor: "#575279",
    recolor: true,
  },
  "sepia-warm": {
    id: "sepia-warm",
    label: "Sepia Warm",
    lightColor: "#FBF0D9",
    darkColor: "#3C3836",
    recolor: true,
  },
  custom: {
    id: "custom",
    label: "Custom",
    lightColor: "#14161B",
    darkColor: "#DCD7BA",
    recolor: true,
  },
};

export const DEFAULT_RECOLOR_SETTINGS: PdfRecolorSettings = {
  recolor: false,
  recolorLightcolor: "#14161B",
  recolorDarkcolor: "#DCD7BA",
  recolorKeephue: false,
  recolorReverseVideo: false,
  recolorAdjustLightness: false,
  activePreset: "zathura-dark",
};

const HEX_COLOR_REGEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value.trim());
}

export function normalizeHexColor(value: string, fallback = "#000000"): string {
  const clean = value.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const [r, g, b] = clean;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (clean.length === 6) {
    return `#${clean}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

export function parseHexColor(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex);
  const num = parseInt(normalized.slice(1), 16);
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
  ];
}

export function formatHexColor([r, g, b]: [number, number, number]): string {
  const toHex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Computes exact 4x5 SVG Color Matrix for standard recoloring.
 * maps white (1,1,1) -> lightColor (bg), black (0,0,0) -> darkColor (fg).
 */
export function computeSvgColorMatrix(lightHex: string, darkHex: string): string {
  const light = parseHexColor(lightHex);
  const dark = parseHexColor(darkHex);

  const dR = light[0] - dark[0];
  const dG = light[1] - dark[1];
  const dB = light[2] - dark[2];

  const [wr, wg, wb] = RECOLOR_WEIGHTS;

  const m00 = (dR * wr).toFixed(6);
  const m01 = (dR * wg).toFixed(6);
  const m02 = (dR * wb).toFixed(6);
  const m04 = dark[0].toFixed(6);

  const m10 = (dG * wr).toFixed(6);
  const m11 = (dG * wg).toFixed(6);
  const m12 = (dG * wb).toFixed(6);
  const m14 = dark[1].toFixed(6);

  const m20 = (dB * wr).toFixed(6);
  const m21 = (dB * wg).toFixed(6);
  const m22 = (dB * wb).toFixed(6);
  const m24 = dark[2].toFixed(6);

  return [
    `${m00} ${m01} ${m02} 0 ${m04}`,
    `${m10} ${m11} ${m12} 0 ${m14}`,
    `${m20} ${m21} ${m22} 0 ${m24}`,
    "0 0 0 1 0",
  ].join(" ");
}

/**
 * Returns maximum saturation for given hue vector h and lightness l.
 * Verified against Zathura colorumax in zathura/render.c.
 */
export function colorumax(h: [number, number, number], l: number, l1: number, l2: number): number {
  if (Math.abs(h[0]) <= 1e-6 && Math.abs(h[1]) <= 1e-6 && Math.abs(h[2]) <= 1e-6) {
    return 0;
  }
  const lSpan = l2 - l1;
  const lv = Math.abs(lSpan) > 1e-6 ? (l - l1) / lSpan : 0;
  let u = 1e9;
  let v = 1e9;

  for (let k = 0; k < 3; k += 1) {
    const hk = h[k];
    if (hk > 1e-6) {
      u = Math.min((1 - l) / hk, u);
      v = Math.min((1 - lv) / hk, v);
    } else if (hk < -1e-6) {
      u = Math.min(l / -hk, u);
      v = Math.min(lv / -hk, v);
    }
  }

  v = Math.abs(lSpan) * v;
  return Math.min(u, v);
}

/**
 * Exact Zathura pixel transformation.
 */
export function recolorPixelZathura(
  rgb: [number, number, number],
  dark: [number, number, number],
  light: [number, number, number],
  keephue: boolean,
  adjustLightness: boolean,
): [number, number, number] {
  const [wr, wg, wb] = RECOLOR_WEIGHTS;
  const l1 = wr * dark[0] + wg * dark[1] + wb * dark[2];
  const l2 = wr * light[0] + wg * light[1] + wb * light[2];

  let l = wr * rgb[0] + wg * rgb[1] + wb * rgb[2];

  if (keephue) {
    const h: [number, number, number] = [rgb[0] - l, rgb[1] - l, rgb[2] - l];
    const u = colorumax(h, l, 0, 1);
    const s = u > 1e-6 ? 1.0 / u : 0.0;

    if (adjustLightness) {
      const adj = l * l * l * l;
      l = (l - adj) * (s * 0.5) + adj;
    }

    l = l * (l2 - l1) + l1;
    const su = s * colorumax(h, l, l1, l2);

    const tr1 = 1 - Math.max(rgb[0], rgb[1], rgb[2]);
    const tr2 = Math.min(rgb[0], rgb[1], rgb[2]);

    const h1 = [dark[0] - l1, dark[1] - l1, dark[2] - l1];
    const h2 = [light[0] - l2, light[1] - l2, light[2] - l2];

    return [
      Math.min(1, Math.max(0, tr1 * h1[0] + tr2 * h2[0] + l + su * h[0])),
      Math.min(1, Math.max(0, tr1 * h1[1] + tr2 * h2[1] + l + su * h[1])),
      Math.min(1, Math.max(0, tr1 * h1[2] + tr2 * h2[2] + l + su * h[2])),
    ];
  }

  if (adjustLightness) {
    l = l * l;
  }

  return [
    Math.min(1, Math.max(0, dark[0] + l * (light[0] - dark[0]))),
    Math.min(1, Math.max(0, dark[1] + l * (light[1] - dark[1]))),
    Math.min(1, Math.max(0, dark[2] + l * (light[2] - dark[2]))),
  ];
}

/**
 * CPU fallback pixel transformation on Uint8ClampedArray.
 */
export function recolorImageDataCpu(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  dark: [number, number, number],
  light: [number, number, number],
  keephue: boolean,
  adjustLightness: boolean,
  reverseVideo: boolean,
  imageRects: NormalizedRect[],
): void {
  const pixelCount = width * height;
  const numRects = reverseVideo ? imageRects.length : 0;

  for (let idx = 0; idx < pixelCount; idx += 1) {
    const offset = idx * 4;
    const x = idx % width;
    const y = Math.floor(idx / width);
    const u = x / width;
    const v = y / height;

    let insideImage = false;
    for (let r = 0; r < numRects; r += 1) {
      const rect = imageRects[r];
      if (u >= rect.minX && u <= rect.maxX && v >= rect.minY && v <= rect.maxY) {
        insideImage = true;
        break;
      }
    }

    if (insideImage) {
      continue;
    }

    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;

    const [outR, outG, outB] = recolorPixelZathura([r, g, b], dark, light, keephue, adjustLightness);

    data[offset] = Math.round(outR * 255);
    data[offset + 1] = Math.round(outG * 255);
    data[offset + 2] = Math.round(outB * 255);
  }
}

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec3 u_dark;
uniform vec3 u_light;
uniform float u_l1;
uniform float u_l2;
uniform bool u_keephue;
uniform bool u_adjustLightness;
uniform bool u_reverseVideo;
uniform int u_numImageRects;
uniform vec4 u_imageRects[64]; // x=minX, y=minY, z=maxX, w=maxY

const vec3 weights = vec3(0.30, 0.59, 0.11);

float colorumax(vec3 h, float l, float l1, float l2) {
  if (abs(h.r) <= 1e-6 && abs(h.g) <= 1e-6 && abs(h.b) <= 1e-6) return 0.0;
  float lSpan = l2 - l1;
  float lv = abs(lSpan) > 1e-6 ? (l - l1) / lSpan : 0.0;
  float u = 1e9;
  float v = 1e9;

  if (h.r > 1e-6) {
    u = min((1.0 - l) / h.r, u);
    v = min((1.0 - lv) / h.r, v);
  } else if (h.r < -1e-6) {
    u = min(l / -h.r, u);
    v = min(lv / -h.r, v);
  }

  if (h.g > 1e-6) {
    u = min((1.0 - l) / h.g, u);
    v = min((1.0 - lv) / h.g, v);
  } else if (h.g < -1e-6) {
    u = min(l / -h.g, u);
    v = min(lv / -h.g, v);
  }

  if (h.b > 1e-6) {
    u = min((1.0 - l) / h.b, u);
    v = min((1.0 - lv) / h.b, v);
  } else if (h.b < -1e-6) {
    u = min(l / -h.b, u);
    v = min(lv / -h.b, v);
  }

  v = abs(lSpan) * v;
  return min(u, v);
}

void main() {
  vec4 color = texture(u_image, v_texCoord);

  if (u_reverseVideo && u_numImageRects > 0) {
    for (int i = 0; i < 64; i++) {
      if (i >= u_numImageRects) break;
      vec4 rect = u_imageRects[i];
      if (v_texCoord.x >= rect.x && v_texCoord.x <= rect.z &&
          v_texCoord.y >= rect.y && v_texCoord.y <= rect.w) {
        fragColor = vec4(color.rgb, 1.0);
        return;
      }
    }
  }

  vec3 rgb = color.rgb;
  float l = dot(weights, rgb);

  if (u_keephue) {
    vec3 h = rgb - vec3(l);
    float u = colorumax(h, l, 0.0, 1.0);
    float s = u > 1e-6 ? 1.0 / u : 0.0;

    if (u_adjustLightness) {
      float adj = l * l * l * l;
      l = (l - adj) * (s * 0.5) + adj;
    }

    l = l * (u_l2 - u_l1) + u_l1;
    float su = s * colorumax(h, l, u_l1, u_l2);

    float tr1 = 1.0 - max(max(rgb.r, rgb.g), rgb.b);
    float tr2 = min(min(rgb.r, rgb.g), rgb.b);

    vec3 h1 = u_dark - vec3(u_l1);
    vec3 h2 = u_light - vec3(u_l2);

    vec3 outRgb = clamp(tr1 * h1 + tr2 * h2 + vec3(l) + su * h, 0.0, 1.0);
    fragColor = vec4(outRgb, 1.0);
  } else {
    if (u_adjustLightness) {
      l = l * l;
    }
    vec3 outRgb = clamp(mix(u_dark, u_light, l), 0.0, 1.0);
    fragColor = vec4(outRgb, 1.0);
  }
}
`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class RecolorShaderRenderer {
  private static instance: RecolorShaderRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  static getInstance(): RecolorShaderRenderer {
    if (!RecolorShaderRenderer.instance) {
      RecolorShaderRenderer.instance = new RecolorShaderRenderer();
    }
    return RecolorShaderRenderer.instance;
  }

  private constructor() {
    if (typeof document === "undefined") return;
    try {
      this.canvas = document.createElement("canvas");
      this.gl = this.canvas.getContext("webgl2", {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      if (this.gl) this.initGl(this.gl);
    } catch (err) {
      console.warn("WebGL2 initialization failed, will fallback to CPU recoloring:", err);
      this.gl = null;
    }
  }

  private initGl(gl: WebGL2RenderingContext): void {
    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  render(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement,
    settings: PdfRecolorSettings,
    imageRects: NormalizedRect[] = [],
  ): boolean {
    const { width, height } = sourceCanvas;
    if (width === 0 || height === 0) return false;

    const dark = parseHexColor(settings.recolorDarkcolor);
    const light = parseHexColor(settings.recolorLightcolor);

    if (this.gl && this.program && this.texture && this.canvas) {
      try {
        const gl = this.gl;
        this.canvas.width = width;
        this.canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

        const [wr, wg, wb] = RECOLOR_WEIGHTS;
        const l1 = wr * dark[0] + wg * dark[1] + wb * dark[2];
        const l2 = wr * light[0] + wg * light[1] + wb * light[2];

        gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);
        gl.uniform3f(gl.getUniformLocation(this.program, "u_dark"), dark[0], dark[1], dark[2]);
        gl.uniform3f(gl.getUniformLocation(this.program, "u_light"), light[0], light[1], light[2]);
        gl.uniform1f(gl.getUniformLocation(this.program, "u_l1"), l1);
        gl.uniform1f(gl.getUniformLocation(this.program, "u_l2"), l2);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_keephue"), settings.recolorKeephue ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_adjustLightness"), settings.recolorAdjustLightness ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_reverseVideo"), settings.recolorReverseVideo ? 1 : 0);

        const rectArray = new Float32Array(64 * 4);
        const rectCount = Math.min(imageRects.length, 64);
        for (let i = 0; i < rectCount; i += 1) {
          const r = imageRects[i];
          rectArray[i * 4] = r.minX;
          rectArray[i * 4 + 1] = r.minY;
          rectArray[i * 4 + 2] = r.maxX;
          rectArray[i * 4 + 3] = r.maxY;
        }

        gl.uniform1i(gl.getUniformLocation(this.program, "u_numImageRects"), rectCount);
        gl.uniform4fv(gl.getUniformLocation(this.program, "u_imageRects"), rectArray);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        const targetCtx = targetCanvas.getContext("2d");
        if (targetCtx) {
          targetCtx.drawImage(this.canvas, 0, 0);
          return true;
        }
      } catch (err) {
        console.warn("WebGL render failed, falling back to CPU:", err);
      }
    }

    // CPU fallback
    const srcCtx = sourceCanvas.getContext("2d");
    const targetCtx = targetCanvas.getContext("2d");
    if (!srcCtx || !targetCtx) return false;

    const imgData = srcCtx.getImageData(0, 0, width, height);
    recolorImageDataCpu(
      imgData.data,
      width,
      height,
      dark,
      light,
      settings.recolorKeephue,
      settings.recolorAdjustLightness,
      settings.recolorReverseVideo,
      imageRects,
    );
    targetCtx.putImageData(imgData, 0, 0);
    return true;
  }
}

const STORAGE_KEY = "clio:pdf-recolor-settings";

export function loadRecolorSettings(): PdfRecolorSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_RECOLOR_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RECOLOR_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PdfRecolorSettings>;
    return {
      recolor: typeof parsed.recolor === "boolean" ? parsed.recolor : DEFAULT_RECOLOR_SETTINGS.recolor,
      recolorLightcolor: isValidHexColor(parsed.recolorLightcolor ?? "")
        ? normalizeHexColor(parsed.recolorLightcolor!)
        : DEFAULT_RECOLOR_SETTINGS.recolorLightcolor,
      recolorDarkcolor: isValidHexColor(parsed.recolorDarkcolor ?? "")
        ? normalizeHexColor(parsed.recolorDarkcolor!)
        : DEFAULT_RECOLOR_SETTINGS.recolorDarkcolor,
      recolorKeephue: Boolean(parsed.recolorKeephue),
      recolorReverseVideo: Boolean(parsed.recolorReverseVideo),
      recolorAdjustLightness: Boolean(parsed.recolorAdjustLightness),
      activePreset: (parsed.activePreset && parsed.activePreset in RECOLOR_PRESETS)
        ? parsed.activePreset
        : DEFAULT_RECOLOR_SETTINGS.activePreset,
    };
  } catch {
    return { ...DEFAULT_RECOLOR_SETTINGS };
  }
}

export function saveRecolorSettings(settings: PdfRecolorSettings): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota/security exceptions in private browsing
  }
}
