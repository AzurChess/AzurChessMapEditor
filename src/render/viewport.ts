/** 世界坐标 ↔ 屏幕像素的平移/缩放。 */
export interface Viewport {
  /** 屏幕像素 / 世界单位。 */
  scale: number;
  /** 视口中心所在的世界坐标。 */
  centerX: number;
  centerY: number;
  /** 画布尺寸（CSS 像素）。 */
  canvasWidth: number;
  canvasHeight: number;
}

export function createViewport(canvasWidth: number, canvasHeight: number): Viewport {
  return { scale: 8, centerX: 0, centerY: 0, canvasWidth, canvasHeight };
}

/** 世界坐标 → 画布像素。世界 Y 向上，画布 Y 向下，此处翻转。 */
export function worldToScreen(v: Viewport, x: number, y: number): { sx: number; sy: number } {
  return {
    sx: (x - v.centerX) * v.scale + v.canvasWidth / 2,
    sy: v.canvasHeight / 2 - (y - v.centerY) * v.scale,
  };
}

/** 画布像素 → 世界坐标。 */
export function screenToWorld(v: Viewport, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - v.canvasWidth / 2) / v.scale + v.centerX,
    y: (v.canvasHeight / 2 - sy) / v.scale + v.centerY,
  };
}

/** 以某个屏幕点为锚缩放，保持该点下的世界坐标不动。 */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number, min = 0.5, max = 120): Viewport {
  const before = screenToWorld(v, sx, sy);
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const after = screenToWorld({ ...v, scale }, sx, sy);
  return {
    ...v,
    scale,
    centerX: v.centerX + (before.x - after.x),
    centerY: v.centerY + (before.y - after.y),
  };
}

/** 让整张地图完整入画。 */
export function fitToMap(
  v: Viewport,
  worldWidth: number,
  worldHeight: number,
  padding = 0.92,
): Viewport {
  const scale = Math.min(v.canvasWidth / worldWidth, v.canvasHeight / worldHeight) * padding;
  return { ...v, scale, centerX: 0, centerY: 0 };
}
