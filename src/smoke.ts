// 开发用渲染冒烟页：把 public/<map>.azurchessmap 完整走一遍解析 → 解码 → 渲染。
// 需要本地自行把一个 .azurchessmap 放进 public/（该目录下的地图不入版本控制）。
import { gridSize, parseMapFile } from './format/mapfile.ts';
import { mapWorldSize } from './format/hex.ts';
import { decodePreview } from './render/decodeImage.ts';
import { renderMap } from './render/renderMap.ts';
import { createViewport, fitToMap } from './render/viewport.ts';

declare global {
  interface Window {
    __done?: string;
    __error?: string;
  }
}

const name = new URLSearchParams(location.search).get('map') ?? 'global';

try {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const bytes = new Uint8Array(await (await fetch(`/${name}.azurchessmap`)).arrayBuffer());
  const map = parseMapFile(bytes);
  const image = await decodePreview(map.image);
  const { width, height } = gridSize(map.info);
  const { worldWidth, worldHeight } = mapWorldSize(width, height);
  const view = fitToMap(createViewport(canvas.width, canvas.height), worldWidth, worldHeight);
  // 传整个 DecodedImage：世界尺寸要用原始像素，不能用降采样后的 bitmap。
  renderMap(ctx, map.info, image, view, {
    showGrid: true,
    showObstacles: true,
    showItems: true,
    showTips: true,
    showBounds: true,
  });
  window.__done = `${name} ${width}x${height} 底图 ${image.width}x${image.height} 降采样=${image.downscaled}`;
} catch (e) {
  window.__error = (e as Error).message;
}
