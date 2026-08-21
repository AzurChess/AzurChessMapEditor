/**
 * 地图渲染。命令式，不经过 React —— 刷格子要 60fps，不能走 reconciliation。
 *
 * 渲染布局刻意复刻客户端 `MapLoader`：
 *  - 底图按 1 世界单位 = 100 像素铺开，中心对齐原点
 *  - `Loop: true` 时左右各再画一份（客户端会实例化三份 mapImage 和三份 Tilemap）
 */
import {
  CELL_HEIGHT,
  PIXELS_PER_UNIT,
  cellToWorld,
  cellsInRadius,
  gridWorldBounds,
  hexCorners,
  indexToCell,
} from '../format/hex.ts';
import { loopShifts } from '../edit/operations.ts';
import type { MapInfo } from '../format/types.ts';
import { worldToScreen, type Viewport } from './viewport.ts';

/**
 * 底图 + 它的**原始**像素尺寸。
 *
 * `bitmap` 可能是 `decodePreview` 降采样后的预览（长边上限 4096），
 * 所以世界尺寸**绝不能**从 `bitmap.width` 推 —— 那样 global 的 8000px 底图
 * 会被当成 4096px，按一半大小铺开。真实尺寸必须跟着 bitmap 一起传。
 */
export interface RenderImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface RenderOptions {
  showGrid: boolean;
  showObstacles: boolean;
  showItems: boolean;
  showTips: boolean;
  /** 画出底图与网格各自的世界包围盒，用来肉眼比对对齐情况。 */
  showBounds?: boolean;
  /** 光标所在格（cell 坐标），用于笔刷预览。 */
  hover?: { cx: number; cy: number } | null;
  /** 笔刷半径，配合 hover 画出覆盖范围。 */
  hoverRadius?: number;
  /** 当前选中的物件 key，画一圈高亮。 */
  selectedKey?: string | null;
}

const OBSTACLE_FILL = 'rgba(214, 64, 69, 0.45)';
const GRID_STROKE = 'rgba(255, 255, 255, 0.13)';
const BASE_FILL = '#4da3ff';
const LIGHTHOUSE_FILL = '#ffd166';
const IMAGE_BOUND_STROKE = '#ff8fab';
const GRID_BOUND_STROKE = '#5ce1a6';

export function renderMap(
  ctx: CanvasRenderingContext2D,
  info: MapInfo,
  image: RenderImage | null,
  view: Viewport,
  options: RenderOptions,
): void {
  const { canvasWidth, canvasHeight } = view;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#0d1826';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const offsets = loopShifts(info);
  const height = info.Grid.length;
  const width = info.Grid[0].length;

  // 底图的世界尺寸由**原始**像素决定，不是 bitmap 的（后者可能已降采样）。
  // 客户端 SetTextureToMap 用整数除法 px/100，此处照做。
  const imageWorldW = image ? Math.floor(image.width / PIXELS_PER_UNIT) : 0;
  const imageWorldH = image ? Math.floor(image.height / PIXELS_PER_UNIT) : 0;

  if (image) {
    ctx.imageSmoothingEnabled = true;
    for (const dx of offsets) {
      const topLeft = worldToScreen(view, dx - imageWorldW / 2, imageWorldH / 2);
      ctx.drawImage(
        image.bitmap,
        topLeft.sx,
        topLeft.sy,
        imageWorldW * view.scale,
        imageWorldH * view.scale,
      );
    }
  }

  // 只画视口内的格子。
  const cellPx = view.scale;
  for (const dx of offsets) {
    if (options.showObstacles || options.showGrid) {
      drawCells(ctx, info, view, dx, width, height, cellPx, options);
    }
  }

  if (options.hover) {
    drawHover(ctx, view, options.hover, options.hoverRadius ?? 0, offsets);
  }

  if (options.showItems) {
    for (const dx of offsets) {
      for (const [name, pos] of Object.entries(info.BasesPosition)) {
        drawMarker(ctx, view, pos.X + dx, pos.Y, BASE_FILL, name, cellPx, false, name === options.selectedKey);
      }
      for (const [id, pos] of Object.entries(info.LighthousesPosition)) {
        drawMarker(ctx, view, pos.X + dx, pos.Y, LIGHTHOUSE_FILL, id, cellPx, true, id === options.selectedKey);
      }
    }
  }

  if (options.showTips) {
    for (const dx of offsets) {
      for (const tip of info.Tips) {
        const { sx, sy } = worldToScreen(view, tip.Position.X + dx, tip.Position.Y);
        if (sx < -200 || sx > canvasWidth + 200 || sy < -50 || sy > canvasHeight + 50) continue;
        const { R, G, B, A } = tip.Color;
        ctx.fillStyle = `rgba(${Math.round(R * 255)}, ${Math.round(G * 255)}, ${Math.round(B * 255)}, ${A})`;
        ctx.font = `${Math.max(9, tip.TextSize * view.scale * 1.4)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tip.Content, sx, sy);
      }
    }
  }

  // 对齐框画在最上层：它是用来比对的参考线，被地形盖住就没意义了。
  if (options.showBounds) {
    drawBounds(ctx, view, info, image ? { w: imageWorldW, h: imageWorldH } : null, offsets);
  }
}

/**
 * 描出底图与网格各自的世界包围盒。
 *
 * 两者的错位在画面上看不出来 —— 美术出血和真正的错位长得一模一样，
 * 只有把边界描出来才能分辨。Loop 地图的底图框按拼接偏移画三份，
 * 相邻两框贴合即说明拼接缝严丝合缝。
 */
function drawBounds(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  info: MapInfo,
  imageWorld: { w: number; h: number } | null,
  offsets: number[],
): void {
  const strokeWorldRect = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    color: string,
  ) => {
    const a = worldToScreen(view, minX, maxY);
    const b = worldToScreen(view, maxX, minY);
    ctx.strokeStyle = color;
    ctx.strokeRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
  };

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);

  if (imageWorld) {
    for (const dx of offsets) {
      strokeWorldRect(
        dx - imageWorld.w / 2,
        -imageWorld.h / 2,
        dx + imageWorld.w / 2,
        imageWorld.h / 2,
        IMAGE_BOUND_STROKE,
      );
    }
  }

  const { width, height } = { width: info.Grid[0].length, height: info.Grid.length };
  const g = gridWorldBounds(width, height);
  strokeWorldRect(g.minX, g.minY, g.maxX, g.maxY, GRID_BOUND_STROKE);

  ctx.restore();
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  info: MapInfo,
  view: Viewport,
  dx: number,
  width: number,
  height: number,
  cellPx: number,
  options: RenderOptions,
): void {
  // 网格线在缩得很小时没有意义，只会糊成一片。
  const drawGrid = options.showGrid && cellPx >= 6;
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_STROKE;
  ctx.fillStyle = OBSTACLE_FILL;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const blocked = info.Grid[row][col] !== 0;
      if (!blocked && !drawGrid) continue;
      if (blocked && !options.showObstacles && !drawGrid) continue;

      const { cx, cy } = indexToCell(row, col, width, height);
      const center = cellToWorld(cx, cy);
      const { sx, sy } = worldToScreen(view, center.x + dx, center.y);
      // 视口裁剪：半个格子的余量足够覆盖六边形外接盒。
      const margin = cellPx * CELL_HEIGHT;
      if (sx < -margin || sx > view.canvasWidth + margin) continue;
      if (sy < -margin || sy > view.canvasHeight + margin) continue;

      ctx.beginPath();
      const corners = hexCorners(center.x + dx, center.y);
      for (let i = 0; i < corners.length; i++) {
        const p = worldToScreen(view, corners[i].x, corners[i].y);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.closePath();
      if (blocked && options.showObstacles) ctx.fill();
      if (drawGrid) ctx.stroke();
    }
  }
}

/** 笔刷落点预览。 */
function drawHover(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  hover: { cx: number; cy: number },
  radius: number,
  offsets: number[],
): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  // cellsInRadius(hover, radius) 不依赖 dx —— 挪到循环外只算一次，
  // 否则 Loop 地图每帧要把同一个笔刷范围重复算三遍。
  const cells = radius > 0 ? cellsInRadius(hover, radius) : [hover];
  for (const dx of offsets) {
    for (const cell of cells) {
      const center = cellToWorld(cell.cx, cell.cy);
      ctx.beginPath();
      const corners = hexCorners(center.x + dx, center.y);
      for (let i = 0; i < corners.length; i++) {
        const p = worldToScreen(view, corners[i].x, corners[i].y);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  x: number,
  y: number,
  color: string,
  label: string,
  cellPx: number,
  small = false,
  selected = false,
): void {
  const { sx, sy } = worldToScreen(view, x, y);
  if (sx < -80 || sx > view.canvasWidth + 80 || sy < -40 || sy > view.canvasHeight + 40) return;

  const radius = Math.max(3, cellPx * (small ? 0.24 : 0.36));
  if (selected) {
    ctx.beginPath();
    ctx.arc(sx, sy, radius + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.stroke();

  if (cellPx >= 10 && !small) {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeText(label, sx, sy - radius - 3);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, sx, sy - radius - 3);
  }
}
