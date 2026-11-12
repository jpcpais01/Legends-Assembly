export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  shadowMapSize: number;
  shadows: boolean;
  grassDensity: number; // blades per m² in the playable ring
  grassShadows: boolean;
  bloom: boolean;
  aa: 'none' | 'fxaa' | 'smaa';
  maxPixelRatio: number;
  particles: number;
  foliage: number; // 0..1 density multiplier for trees/rocks dressing
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low:    { shadowMapSize: 1024, shadows: true,  grassDensity: 6,  grassShadows: false, bloom: true, aa: 'fxaa', maxPixelRatio: 1.0, particles: 1500, foliage: 0.5 },
  medium: { shadowMapSize: 2048, shadows: true,  grassDensity: 14, grassShadows: false, bloom: true, aa: 'smaa', maxPixelRatio: 1.25, particles: 3000, foliage: 0.8 },
  high:   { shadowMapSize: 2048, shadows: true,  grassDensity: 24, grassShadows: true,  bloom: true, aa: 'smaa', maxPixelRatio: 1.5, particles: 5000, foliage: 1 },
  ultra:  { shadowMapSize: 4096, shadows: true,  grassDensity: 36, grassShadows: true,  bloom: true, aa: 'smaa', maxPixelRatio: 2.0, particles: 8000, foliage: 1 },
};

export interface Settings {
  quality: QualityLevel;
  dynamicResolution: boolean;
  sensitivity: number;
  fov: number;
  volume: number;
  music: number;
  showFps: boolean;
  invertY: boolean;
  playerName: string;
  botDifficulty: 'easy' | 'normal' | 'hard';
  arena: 'study' | 'ruins';
  /** HUD size multiplier (0.8 to 1.25). */
  hudScale: number;
  damageNumbers: boolean;
  crosshairColor: string;
}

const KEY = 'legends-assembly:settings:v1';

function detectQuality(): QualityLevel {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) as string;
    const s = (r || '').toLowerCase();
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (mobile) return 'low';
    if (/rtx|radeon rx [67]|rx 7|rx 6|apple m[2-9]|apple m1 (pro|max|ultra)|arc a7/.test(s)) return 'high';
    if (/geforce|radeon|apple m1|arc/.test(s)) return 'medium';
    if (/iris xe|iris\(r\) xe|780m|680m|radeon\(tm\) graphics/.test(s)) return 'medium';
    return 'low';
  } catch {
    return 'medium';
  }
}

function defaults(): Settings {
  return {
    quality: detectQuality(),
    dynamicResolution: true,
    sensitivity: 1,
    fov: 82,
    volume: 0.8,
    music: 0.5,
    showFps: true,
    invertY: false,
    playerName: 'Player',
    botDifficulty: 'normal',
    arena: 'study',
    hudScale: 1,
    damageNumbers: true,
    crosshairColor: '#ffffff',
  };
}

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return d;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const settings: Settings = loadSettings();
