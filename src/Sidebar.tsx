/** 右侧属性面板。纯受控组件，所有改动通过回调交回 App。 */
import type { MapInfo, TipData } from './format/types.ts';
import { VALID_BASE_NAMES } from './format/types.ts';
import { gridSize } from './format/mapfile.ts';
import { suggestGridSize } from './edit/mask.ts';
import { refLabel, sameRef, type ItemRef } from './edit/operations.ts';
import { imageAlignment } from './validate.ts';

export interface SidebarProps {
  info: MapInfo;
  imageSize: { width: number; height: number } | null;
  selected: ItemRef | null;
  onSelect: (ref: ItemRef | null) => void;
  onResize: (width: number, height: number) => void;
  onToggleLoop: (loop: boolean) => void;
  onRename: (ref: ItemRef, key: string) => void;
  onDelete: (ref: ItemRef) => void;
  onTipChange: (index: number, patch: Partial<TipData>) => void;
  onGenerateMask: () => void;
  onReplaceImage: () => void;
  onFitGridToImage: () => void;
}

function colorToHex(c: TipData['Color']): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.R)}${to(c.G)}${to(c.B)}`;
}

function hexToColor(hex: string, alpha: number): TipData['Color'] {
  return {
    R: parseInt(hex.slice(1, 3), 16) / 255,
    G: parseInt(hex.slice(3, 5), 16) / 255,
    B: parseInt(hex.slice(5, 7), 16) / 255,
    A: alpha,
  };
}

export default function Sidebar(props: SidebarProps) {
  const { info, selected } = props;
  const { width, height } = gridSize(info);
  const selectedTip =
    selected?.kind === 'tip' ? (info.Tips[selected.index] ?? null) : null;

  return (
    <aside className="sidebar">
      <section>
        <h3>地图</h3>
        <div className="field">
          <label>列数</label>
          <input
            type="number"
            min={1}
            max={512}
            value={width}
            onChange={(e) => props.onResize(Math.max(1, Number(e.target.value) || 1), height)}
          />
        </div>
        <div className="field">
          <label>行数</label>
          <input
            type="number"
            min={1}
            max={512}
            value={height}
            onChange={(e) => props.onResize(width, Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={info.Loop}
            onChange={(e) => props.onToggleLoop(e.target.checked)}
          />
          东西环绕（Loop）
        </label>
      </section>

      <section>
        <h3>底图</h3>
        <p className="hint">
          {props.imageSize
            ? `${props.imageSize.width} × ${props.imageSize.height} px`
            : '未载入'}
        </p>
        <AlignmentReadout {...props} />
        <button className="button wide" onClick={props.onReplaceImage}>
          更换底图
        </button>
        <button className="button wide" onClick={props.onGenerateMask}>
          从底图生成障碍
        </button>
        <p className="hint">
          按每格不透明像素占比判定，与 global 的手绘网格一致率约 96%。
          会覆盖现有障碍，可撤销。
        </p>
      </section>

      <section>
        <h3>基地 {Object.keys(info.BasesPosition).length} / {VALID_BASE_NAMES.length}</h3>
        <ItemList
          entries={Object.keys(info.BasesPosition).map((key) => ({
            ref: { kind: 'base', key } as ItemRef,
            label: key,
            bad: !(VALID_BASE_NAMES as readonly string[]).includes(key),
          }))}
          {...props}
        />
      </section>

      <section>
        <h3>灯塔 {Object.keys(info.LighthousesPosition).length}</h3>
        <ItemList
          entries={Object.keys(info.LighthousesPosition).map((key) => ({
            ref: { kind: 'lighthouse', key } as ItemRef,
            label: key,
            bad: false,
          }))}
          {...props}
        />
      </section>

      <section>
        <h3>标注 {info.Tips.length}</h3>
        <ItemList
          entries={info.Tips.map((tip, index) => ({
            ref: { kind: 'tip', index } as ItemRef,
            label: tip.Content || '(空)',
            bad: false,
          }))}
          {...props}
        />
        {selectedTip && selected?.kind === 'tip' && (
          <div className="tip-editor">
            <div className="field">
              <label>文本</label>
              <input
                value={selectedTip.Content}
                onChange={(e) => props.onTipChange(selected.index, { Content: e.target.value })}
              />
            </div>
            <div className="field">
              <label>字号</label>
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={selectedTip.TextSize}
                onChange={(e) =>
                  props.onTipChange(selected.index, { TextSize: Number(e.target.value) || 0.1 })
                }
              />
            </div>
            <div className="field">
              <label>颜色</label>
              <input
                type="color"
                value={colorToHex(selectedTip.Color)}
                onChange={(e) =>
                  props.onTipChange(selected.index, {
                    Color: hexToColor(e.target.value, selectedTip.Color.A),
                  })
                }
              />
            </div>
            <div className="field">
              <label>不透明</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selectedTip.Color.A}
                onChange={(e) =>
                  props.onTipChange(selected.index, {
                    Color: { ...selectedTip.Color, A: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>
        )}
      </section>
    </aside>
  );
}

/** 差值格式化：0.00 一律显示为「持平」，避免 -0 和 0.001 这种噪音。 */
function delta(v: number): string {
  if (Math.abs(v) < 0.005) return '持平';
  return `${v > 0 ? '宽' : '窄'} ${Math.abs(v).toFixed(2)} 格`;
}

/**
 * 底图与网格的对齐读数。
 *
 * 刻意**不**报警告：底图比网格大一圈或小一圈是正常的美术出血 ——
 * operation 每侧宽出 4.5 格，global 比网格矮 6.46 格（露出来的南北极行
 * 正是障碍掩膜 outsideValue=1 的由来）。唯一的硬约束是 Loop 的拼接宽度，
 * 那条由 validate() 报成 error。
 */
function AlignmentReadout(props: SidebarProps) {
  const { info, imageSize } = props;
  if (!imageSize) return null;

  const a = imageAlignment(info, imageSize.width, imageSize.height);

  return (
    <>
      <p className="hint">
        底图 {a.imageWorld.width} × {a.imageWorld.height} 格 · 网格{' '}
        {a.gridWorld.width.toFixed(2)} × {a.gridWorld.height.toFixed(2)} 格
        <br />
        横向 {delta(a.overhang.x)} · 纵向 {delta(a.overhang.y)}
      </p>
      {info.Loop && !a.loopSeamExact && (
        <p className="hint warn">
          Loop 拼接要求底图宽度精确等于 {a.loopRequiredPx}px，当前 {imageSize.width}px。
          拼接缝会错位 —— 需要重新导出底图，或把列数改成{' '}
          {Math.floor(imageSize.width / 100)}。
        </p>
      )}
      {a.truncated.x > 0.005 && (
        <p className="hint">
          客户端按 floor(px/100) 取整，横向丢掉 {a.truncated.x.toFixed(2)} 格
          （压缩 {((a.truncated.x / (a.imageWorld.width || 1)) * 100).toFixed(3)}%），可忽略。
        </p>
      )}
      <button className="button wide" onClick={props.onFitGridToImage}>
        按底图调整网格
      </button>
      <p className="hint">
        把行列数改成 {suggestLabel(imageSize)}，让网格贴合底图。
        这会改变可航行范围，不只是显示，可撤销。
      </p>
    </>
  );
}

function suggestLabel(size: { width: number; height: number }): string {
  const { width, height } = suggestGridSize(size.width, size.height);
  return `${width} × ${height}`;
}

function ItemList({
  entries,
  selected,
  onSelect,
  onDelete,
  onRename,
  info,
}: SidebarProps & {
  entries: Array<{ ref: ItemRef; label: string; bad: boolean }>;
}) {
  if (entries.length === 0) return <p className="hint">（无）</p>;
  return (
    <ul className="item-list">
      {entries.map((entry) => (
        <li
          key={`${entry.ref.kind}-${entry.ref.kind === 'tip' ? entry.ref.index : entry.ref.key}`}
          className={sameRef(entry.ref, selected) ? 'selected' : ''}
        >
          <button className="item-name" onClick={() => onSelect(entry.ref)}>
            <span className={entry.bad ? 'bad' : ''}>{entry.label}</span>
          </button>
          {sameRef(entry.ref, selected) && (
            <input
              className="rename"
              defaultValue={refLabel(info, entry.ref)}
              onBlur={(e) => onRename(entry.ref, e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          )}
          <button className="item-delete" title="删除" onClick={() => onDelete(entry.ref)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
