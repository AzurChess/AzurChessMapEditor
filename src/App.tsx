/**
 * 编辑器外壳。
 *
 * 地图数据刻意留在 ref 里：涂刷要 60fps，每一格都过一遍 React
 * reconciliation 是撑不住的。React 只负责工具栏、侧栏与校验，
 * 画布走命令式渲染，改动后手动 draw()。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createEmptyMap, gridSize, parseMapFile, serializeMapFile } from './format/mapfile.ts';
import { VALID_BASE_NAMES, type MapFile, type TipData } from './format/types.ts';
import { cellLine, mapWorldSize, worldToCell } from './format/hex.ts';
import { History } from './edit/history.ts';
import { DEFAULT_MASK_OPTIONS, generateMask, imageWorldSize, suggestGridSize } from './edit/mask.ts';
import {
  cellUnderCursor,
  deleteItem,
  hitTestItem,
  itemPosition,
  itemsOutsideGrid,
  moveItem,
  nextFreeBaseName,
  paintCells,
  placeItem,
  refLabel,
  renameItem,
  resizeGrid,
  type ItemRef,
  type Tool,
} from './edit/operations.ts';
import {
  downloadBytes,
  openMap,
  saveMapAs,
  supportsFileSystemAccess,
  writeToHandle,
} from './edit/fileAccess.ts';
import { decodePreview, type DecodedImage } from './render/decodeImage.ts';
import { bitmapToImageData } from './render/imageData.ts';
import { renderMap } from './render/renderMap.ts';
import { createViewport, fitToMap, screenToWorld, zoomAt, type Viewport } from './render/viewport.ts';
import { validate, type Issue } from './validate.ts';
import Sidebar from './Sidebar.tsx';
import './App.css';

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'pan', label: '浏览', hint: '拖拽平移（V）' },
  {
    id: 'block',
    label: '障碍笔',
    hint: '左键画障碍，右键擦除（B）；Alt+右键横拖调笔刷大小',
  },
  {
    id: 'clear',
    label: '橡皮',
    hint: '左键擦除，右键画障碍（E）；Alt+右键横拖调笔刷大小',
  },
  { id: 'base', label: '基地', hint: '点击放置基地' },
  { id: 'lighthouse', label: '灯塔', hint: '点击放置灯塔' },
  { id: 'tip', label: '标注', hint: '点击放置地名标注（T）' },
  { id: 'select', label: '选择', hint: '拖动 / Delete 删除（S）' },
];

/** 1×1 全透明 PNG，新建地图时先占位，随后由用户导入的底图替换。 */
const BLANK_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapFile | null>(null);
  const imageRef = useRef<DecodedImage | null>(null);
  const viewRef = useRef<Viewport>(createViewport(800, 600));
  const historyRef = useRef(new History());
  const hoverRef = useRef<{ cx: number; cy: number } | null>(null);
  const selectedRef = useRef<ItemRef | null>(null);
  const toolRef = useRef<Tool>('pan');
  const radiusRef = useRef(0);
  /** 空格按住期间左键也拖视野，跟工具无关，所以单独用 ref 记，不进 state。 */
  const spaceRef = useRef(false);
  const imagePickerRef = useRef<HTMLInputElement>(null);
  /** 导入底图是「新建」还是「更换」。 */
  const imageIntentRef = useRef<'new' | 'replace'>('new');
  /** 支持 File System Access 时保留句柄，用于原地保存。 */
  const handleRef = useRef<FileSystemFileHandle | null>(null);

  const [tool, setTool] = useState<Tool>('pan');
  const [radius, setRadius] = useState(0);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [cursor, setCursor] = useState('');
  const [dirty, setDirty] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [selected, setSelected] = useState<ItemRef | null>(null);
  /** 侧栏读 mapRef 的内容，靠这个计数器触发重渲染。 */
  const [revision, setRevision] = useState(0);
  const [options, setOptions] = useState({
    showGrid: true,
    showObstacles: true,
    showItems: true,
    showTips: true,
    showBounds: true,
  });
  const optionsRef = useRef(options);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!map) {
      ctx.fillStyle = '#0d1826';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const painting = toolRef.current === 'block' || toolRef.current === 'clear';
    const ref = selectedRef.current;
    renderMap(ctx, map.info, imageRef.current, viewRef.current, {
      ...optionsRef.current,
      hover: painting ? hoverRef.current : null,
      hoverRadius: radiusRef.current,
      selectedKey: ref && ref.kind !== 'tip' ? ref.key : null,
    });
  }, []);

  /** 一次改动之后：重画、刷新校验、标脏、通知侧栏。 */
  const afterEdit = useCallback(
    (options?: { structural?: boolean }) => {
      const map = mapRef.current;
      if (!map) return;
      setDirty(true);
      setHistoryState({
        canUndo: historyRef.current.canUndo,
        canRedo: historyRef.current.canRedo,
      });
      setIssues(validate(map.info, imageRef.current?.width));
      if (options?.structural !== false) setRevision((r) => r + 1);
      draw();
    },
    [draw],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      viewRef.current = { ...viewRef.current, canvasWidth: rect.width, canvasHeight: rect.height };
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(draw, [draw, options, tool, radius, selected, revision]);

  const adoptMap = useCallback(
    (map: MapFile, image: DecodedImage, name: string) => {
      mapRef.current = map;
      imageRef.current = image;
      historyRef.current.clear();
      setSelected(null);
      setHistoryState({ canUndo: false, canRedo: false });

      const { width, height } = gridSize(map.info);
      const { worldWidth, worldHeight } = mapWorldSize(width, height);
      viewRef.current = fitToMap(viewRef.current, worldWidth, worldHeight);

      setFileName(name);
      setSummary(
        [
          `${width} × ${height} 格`,
          map.info.Loop ? '东西环绕' : '不环绕',
          `底图 ${image.width}×${image.height}${image.downscaled ? '（预览已降采样）' : ''}`,
        ].join(' · '),
      );
      setIssues(validate(map.info, image.width));
      setRevision((r) => r + 1);
      draw();
    },
    [draw],
  );

  const openFile = useCallback(
    async (file: File, handle: FileSystemFileHandle | null = null) => {
      try {
        const map = parseMapFile(new Uint8Array(await file.arrayBuffer()));
        handleRef.current = handle;
        adoptMap(map, await decodePreview(map.image), file.name);
        setDirty(false);
      } catch (e) {
        setIssues([{ level: 'error', message: `打开失败：${(e as Error).message}` }]);
      }
    },
    [adoptMap],
  );

  /** 走系统文件选择器；不支持时由 <input type=file> 兜底。 */
  const openViaPicker = useCallback(async () => {
    const opened = await openMap();
    if (opened) void openFile(opened.file, opened.handle);
  }, [openFile]);

  /** 导入 PNG：新建一张地图，或替换当前地图的底图。 */
  const importImage = useCallback(
    async (file: File) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const image = await decodePreview(bytes);
        const intent = imageIntentRef.current;

        if (intent === 'replace' && mapRef.current) {
          historyRef.current.push(mapRef.current.info);
          mapRef.current.image = bytes;
          imageRef.current = image;
          setSummary((s) => s.replace(/底图 .*/, `底图 ${image.width}×${image.height}`));
          afterEdit();
          return;
        }

        const { width, height } = suggestGridSize(image.width, image.height);
        handleRef.current = null; // 新地图还没有落盘位置
        const map = createEmptyMap(width, height, bytes);
        adoptMap(map, image, file.name.replace(/\.(png|jpe?g)$/i, '') + '.azurchessmap');
        setDirty(true);
      } catch (e) {
        setIssues([{ level: 'error', message: `导入底图失败：${(e as Error).message}` }]);
      }
    },
    [adoptMap, afterEdit],
  );

  const pickImage = useCallback((intent: 'new' | 'replace') => {
    imageIntentRef.current = intent;
    imagePickerRef.current?.click();
  }, []);

  const newBlankMap = useCallback(() => {
    void (async () => {
      handleRef.current = null;
      const map = createEmptyMap(40, 40, BLANK_PNG);
      adoptMap(map, await decodePreview(BLANK_PNG), 'untitled.azurchessmap');
      setDirty(true);
    })();
  }, [adoptMap]);

  const save = useCallback(
    async (forceDialog: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      const bytes = serializeMapFile(map);
      const name = fileName || 'untitled.azurchessmap';
      try {
        if (!forceDialog && handleRef.current) {
          await writeToHandle(handleRef.current, bytes);
          setDirty(false);
          return;
        }
        if (!supportsFileSystemAccess()) {
          downloadBytes(bytes, name);
          setDirty(false);
          return;
        }
        const handle = await saveMapAs(bytes, name);
        if (!handle) return; // 用户取消
        handleRef.current = handle;
        setFileName(handle.name ?? name);
        setDirty(false);
      } catch (e) {
        setIssues((prev) => [
          { level: 'error', message: `保存失败：${(e as Error).message}` },
          ...prev,
        ]);
      }
    },
    [fileName],
  );

  const undo = useCallback(() => {
    const map = mapRef.current;
    if (!map || !historyRef.current.undo(map.info)) return;
    setSelected(null);
    afterEdit();
  }, [afterEdit]);

  const redo = useCallback(() => {
    const map = mapRef.current;
    if (!map || !historyRef.current.redo(map.info)) return;
    afterEdit();
  }, [afterEdit]);

  /** 改网格行列数去贴合底图 —— 两个对齐杠杆里不动底图字节的那个。 */
  const fitGridToImage = useCallback(() => {
    const map = mapRef.current;
    const image = imageRef.current;
    if (!map || !image) return;
    const next = suggestGridSize(image.width, image.height);
    const { width, height } = gridSize(map.info);
    if (next.width === width && next.height === height) return;

    historyRef.current.push(map.info);
    resizeGrid(map.info, next.width, next.height);
    const stray = itemsOutsideGrid(map.info);
    afterEdit();
    setIssues((prev) => [
      {
        level: 'warning',
        message:
          `网格已按底图调整为 ${next.width} × ${next.height}（原 ${width} × ${height}）。` +
          `这会改变可航行范围，不是纯粹的显示调整，可撤销。` +
          (stray.length > 0
            ? `另有 ${stray.length} 个物件落到网格外：${stray
                .map((r) => refLabel(map.info, r))
                .join('、')}`
            : ''),
      },
      ...prev,
    ]);
  }, [afterEdit]);

  const runMask = useCallback(() => {
    const map = mapRef.current;
    const image = imageRef.current;
    if (!map || !image) return;
    try {
      const pixels = bitmapToImageData(image.bitmap);
      const { width, height } = gridSize(map.info);
      const { worldWidth, worldHeight } = imageWorldSize(image.width, image.height);
      historyRef.current.push(map.info);
      map.info.Grid = generateMask(
        pixels,
        worldWidth,
        worldHeight,
        width,
        height,
        DEFAULT_MASK_OPTIONS,
      );
      afterEdit();
    } catch (e) {
      setIssues([{ level: 'error', message: `生成障碍失败：${(e as Error).message}` }]);
    }
  }, [afterEdit]);

  // 指针交互。监听器只装一次，工具/半径通过 ref 读取。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mode: 'none' | 'pan' | 'paint' | 'drag' | 'resize' = 'none';
    let lastScreen = { x: 0, y: 0 };
    let lastCell: { cx: number; cy: number } | null = null;
    let dragRef: ItemRef | null = null;
    /** 当前这次涂刷落笔的值：由按下的是左键还是右键决定，拖动过程中保持不变。 */
    let paintValue: 0 | 1 = 1;
    /** Alt+右键拖动调笔刷半径时，记录起点位置与起点半径，用横向位移换算增量。 */
    let resizeStart = { x: 0, radius: 0 };

    const worldAt = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    };

    const onPointerDown = (e: PointerEvent) => {
      const map = mapRef.current;
      if (!map) return;
      canvas.setPointerCapture(e.pointerId);
      lastScreen = { x: e.clientX, y: e.clientY };
      const world = worldAt(e);
      const activeTool = toolRef.current;

      // 空格+左键跟中键、浏览工具一样拖视野，优先级最高，盖过当前工具本身的左键行为。
      if (e.button === 1 || activeTool === 'pan' || (spaceRef.current && e.button === 0)) {
        mode = 'pan';
        return;
      }

      // Alt+右键按住横拖调笔刷半径，仅障碍笔/橡皮工具下生效，且不落笔。
      if ((activeTool === 'block' || activeTool === 'clear') && e.button === 2 && e.altKey) {
        mode = 'resize';
        resizeStart = { x: e.clientX, radius: radiusRef.current };
        return;
      }

      // 障碍笔/橡皮工具下，右键直接画反色（不用切工具）；其它工具的右键仍是取消选中。
      if ((activeTool === 'block' || activeTool === 'clear') && e.button === 2) {
        historyRef.current.push(map.info);
        mode = 'paint';
        paintValue = activeTool === 'block' ? 0 : 1;
        const cell = worldToCell(world.x, world.y);
        lastCell = cell;
        paintCells(map.info, [cell], paintValue, radiusRef.current);
        afterEdit({ structural: false });
        return;
      }
      if (e.button === 2) {
        setSelected(null);
        return;
      }

      if (activeTool === 'block' || activeTool === 'clear') {
        historyRef.current.push(map.info);
        mode = 'paint';
        paintValue = activeTool === 'block' ? 1 : 0;
        const cell = worldToCell(world.x, world.y);
        lastCell = cell;
        paintCells(map.info, [cell], paintValue, radiusRef.current);
        afterEdit({ structural: false });
        return;
      }

      if (activeTool === 'base' || activeTool === 'lighthouse' || activeTool === 'tip') {
        // placeItem 只在基地名用尽时失败，且失败前不产生任何改动 —— 提前判断，
        // 避免 push() 在没有真实编辑的情况下把 redo 栈清空。
        if (activeTool === 'base' && nextFreeBaseName(map.info, VALID_BASE_NAMES) === null) {
          setIssues((prev) => [
            {
              level: 'warning',
              message: `${VALID_BASE_NAMES.length} 个阵营基地都已放置，先删掉一个再放`,
            },
            ...prev,
          ]);
          return;
        }
        historyRef.current.push(map.info);
        const ref = placeItem(map.info, activeTool, world.x, world.y, VALID_BASE_NAMES);
        setSelected(ref);
        afterEdit();
        return;
      }

      if (activeTool === 'select') {
        const hit = hitTestItem(map.info, world.x, world.y);
        setSelected(hit);
        if (hit) {
          historyRef.current.push(map.info);
          dragRef = hit;
          mode = 'drag';
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const map = mapRef.current;
      if (!map) return;
      const world = worldAt(e);

      hoverRef.current = cellUnderCursor(map.info, world.x, world.y);
      const cell = worldToCell(world.x, world.y);
      setCursor(`世界 (${world.x.toFixed(2)}, ${world.y.toFixed(2)}) · 格 (${cell.cx}, ${cell.cy})`);

      if (mode === 'pan') {
        const v = viewRef.current;
        viewRef.current = {
          ...v,
          centerX: v.centerX - (e.clientX - lastScreen.x) / v.scale,
          centerY: v.centerY + (e.clientY - lastScreen.y) / v.scale,
        };
        lastScreen = { x: e.clientX, y: e.clientY };
        draw();
        return;
      }

      if (mode === 'paint') {
        // 拖快时两帧之间会跳格，用 cellLine 把中间补上，否则笔迹是断的
        const cells = lastCell ? cellLine(lastCell, cell) : [cell];
        lastCell = cell;
        if (paintCells(map.info, cells, paintValue, radiusRef.current)) {
          afterEdit({ structural: false });
        }
        return;
      }

      if (mode === 'resize') {
        // 每 20px 横向位移换算 1 格半径，跟橡皮擦一样共用 0~4 的范围。
        const next = Math.max(
          0,
          Math.min(4, resizeStart.radius + Math.round((e.clientX - resizeStart.x) / 20)),
        );
        if (next !== radiusRef.current) {
          radiusRef.current = next;
          setRadius(next);
        }
        draw();
        return;
      }

      if (mode === 'drag' && dragRef) {
        moveItem(map.info, dragRef, world.x, world.y);
        afterEdit({ structural: false });
        return;
      }

      draw();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (mode === 'paint' || mode === 'drag') setRevision((r) => r + 1);
      mode = 'none';
      lastCell = null;
      dragRef = null;
      canvas.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      viewRef.current = zoomAt(
        viewRef.current,
        e.clientX - rect.left,
        e.clientY - rect.top,
        e.deltaY < 0 ? 1.15 : 1 / 1.15,
      );
      draw();
    };

    const onLeave = () => {
      hoverRef.current = null;
      draw();
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [afterEdit, draw]);

  const removeSelected = useCallback(() => {
    const map = mapRef.current;
    const ref = selectedRef.current;
    if (!map || !ref) return;
    historyRef.current.push(map.info);
    deleteItem(map.info, ref);
    setSelected(null);
    afterEdit();
  }, [afterEdit]);

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        // 阻止默认行为：不然空格会当页面滚动键，或者重复触发当前聚焦按钮的点击。
        e.preventDefault();
        spaceRef.current = true;
        canvasRef.current?.classList.add('space-pan');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete') {
        removeSelected();
        return;
      }
      const shortcuts: Record<string, Tool> = {
        b: 'block',
        e: 'clear',
        v: 'pan',
        s: 'select',
        t: 'tip',
      };
      const next = shortcuts[e.key.toLowerCase()];
      if (next) setTool(next);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        canvasRef.current?.classList.remove('space-pan');
      }
    };
    // 切窗口/切标签页时不会触发 keyup，空格状态会卡住，靠 blur 兜底清掉。
    const onBlur = () => {
      spaceRef.current = false;
      canvasRef.current?.classList.remove('space-pan');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [redo, removeSelected, save, undo]);

  const map = mapRef.current;
  const painting = tool === 'block' || tool === 'clear';

  return (
    <div className="app">
      <header className="toolbar">
        {supportsFileSystemAccess() ? (
          <button className="button" onClick={() => void openViaPicker()}>
            打开
          </button>
        ) : (
          <label className="button">
            打开
            <input
              type="file"
              accept=".azurchessmap"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void openFile(file);
                e.target.value = '';
              }}
            />
          </label>
        )}
        <button className="button" onClick={() => pickImage('new')}>
          从底图新建
        </button>
        <button className="button" onClick={newBlankMap}>
          空白新建
        </button>
        <button
          className="button"
          onClick={() => void save(false)}
          disabled={!map}
          title={handleRef.current ? '原地保存（Ctrl+S）' : '选择保存位置（Ctrl+S）'}
        >
          保存{dirty ? ' *' : ''}
        </button>
        <button className="button" onClick={() => void save(true)} disabled={!map}>
          另存为
        </button>
        <button className="button" onClick={undo} disabled={!historyState.canUndo}>
          撤销
        </button>
        <button className="button" onClick={redo} disabled={!historyState.canRedo}>
          重做
        </button>

        <span className="divider" />

        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`button ${tool === t.id ? 'active' : ''}`}
            title={t.hint}
            onClick={() => setTool(t.id)}
            disabled={!map}
          >
            {t.label}
          </button>
        ))}

        {painting && (
          <label className="toggle">
            笔刷
            <input
              type="range"
              min={0}
              max={4}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            />
            {radius === 0 ? '单格' : `半径 ${radius}`}
          </label>
        )}

        <span className="spacer" />

        {(['showGrid', 'showObstacles', 'showItems', 'showTips', 'showBounds'] as const).map(
          (key) => (
            <label
              key={key}
              className="toggle"
              title={key === 'showBounds' ? '描出底图与网格各自的边界，用来比对对齐' : undefined}
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
              />
              {
                {
                  showGrid: '网格',
                  showObstacles: '障碍',
                  showItems: '基地/灯塔',
                  showTips: '标注',
                  showBounds: '对齐框',
                }[key]
              }
            </label>
          ),
        )}
      </header>

      <div className="body">
        <canvas ref={canvasRef} className={`canvas tool-${tool}`} />
        {map && (
          <Sidebar
            key={revision}
            info={map.info}
            imageSize={
              imageRef.current
                ? { width: imageRef.current.width, height: imageRef.current.height }
                : null
            }
            selected={selected}
            onSelect={(ref) => {
              setSelected(ref);
              const pos = ref && map ? itemPosition(map.info, ref) : null;
              if (pos) {
                viewRef.current = { ...viewRef.current, centerX: pos.X, centerY: pos.Y };
                draw();
              }
            }}
            onResize={(width, height) => {
              historyRef.current.push(map.info);
              resizeGrid(map.info, width, height);
              const stray = itemsOutsideGrid(map.info);
              afterEdit();
              if (stray.length > 0) {
                setIssues((prev) => [
                  {
                    level: 'warning',
                    message: `改尺寸后有 ${stray.length} 个物件落到网格外：${stray
                      .map((r) => refLabel(map.info, r))
                      .join('、')}`,
                  },
                  ...prev,
                ]);
              }
            }}
            onToggleLoop={(loop) => {
              historyRef.current.push(map.info);
              map.info.Loop = loop;
              setSummary((s) => s.replace(/东西环绕|不环绕/, loop ? '东西环绕' : '不环绕'));
              afterEdit();
            }}
            onRename={(ref, key) => {
              if (!key) return;
              historyRef.current.push(map.info);
              if (!renameItem(map.info, ref, key)) {
                setIssues((prev) => [{ level: 'error', message: `「${key}」已存在` }, ...prev]);
                return;
              }
              if (ref.kind !== 'tip') setSelected({ kind: ref.kind, key });
              afterEdit();
            }}
            onDelete={(ref) => {
              historyRef.current.push(map.info);
              deleteItem(map.info, ref);
              setSelected(null);
              afterEdit();
            }}
            onTipChange={(index, patch) => {
              const tip = map.info.Tips[index] as TipData | undefined;
              if (!tip) return;
              historyRef.current.push(map.info);
              Object.assign(tip, patch);
              afterEdit();
            }}
            onGenerateMask={runMask}
            onReplaceImage={() => pickImage('replace')}
            onFitGridToImage={fitGridToImage}
          />
        )}
      </div>

      <footer className="status">
        <span>{summary || '打开一个 .azurchessmap，或从一张 PNG 底图新建'}</span>
        <span className="spacer" />
        <span>{cursor}</span>
      </footer>

      {issues.length > 0 && (
        <aside className="issues">
          {issues.slice(0, 10).map((issue, i) => (
            <div key={i} className={`issue issue-${issue.level}`}>
              {issue.level === 'error' ? '✖' : '⚠'} {issue.message}
            </div>
          ))}
        </aside>
      )}

      <input
        ref={imagePickerRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importImage(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
