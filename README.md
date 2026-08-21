# AzurChess 地图编辑器

AzurChess 客户端 `.azurchessmap` 地图文件的编辑器，React + TypeScript + Vite，纯前端、无后端。

替代已失去源码的旧版 ACME（`AzurChessMapEditor.exe`，2024）。旧版写的是自定义二进制格式，
与当前客户端不兼容；本工具通过逆向现有格式的地图文件来还原地图数据。

## 开发

```bash
npm install
npm run dev     # 开发服务器
npm run build   # 产出 dist/
npm run build:single   # 产出 dist-single/index.html，单文件，双击即用
```

## 文件格式

`.azurchessmap` 是一个 ZIP，内含两个条目，**名字必须精确匹配** ——
客户端 `FileUtils.ReadZipFile` 找不到就抛 `FileNotFoundException`：

| 条目 | 内容 |
| --- | --- |
| `info.json` | UTF-8 JSON，对应客户端 `Assets/Scripts/LocalDataPacks/MapInfo.cs` |
| `map.png` | 背景底图。本工具**原样透传**，不重新编码 |

`info.json` 的字段：

```jsonc
{
  "Grid": [[0, 1, ...], ...],  // 外层=行(由南向北)，内层=列；0=可航行，1=障碍
  "Loop": true,                 // 东西方向是否环绕
  "BasesPosition":       { "Japan": { "X": 29.0, "Y": 8.55 } },
  "LighthousesPosition": { "任意唯一字符串": { "X": 14.0, "Y": 0.0 } },
  "Tips": [{ "TextSize": 1.0, "Color": { "R": 1, "G": 1, "B": 1, "A": 1 },
             "Content": "大西洋", "Position": { "X": -16.1, "Y": 3.8 } }]
}
```

- **`Grid` 是数字 0/1，不是布尔。** 客户端声明为 `List<List<short>>`，取值是
  `MapLoader.tileList` 的下标。旧 ACME 写的是 `List<List<bool>>`。
- **行序由南向北**，`Grid[0]` 是最南一行。
- **坐标是世界坐标，不是格子下标**，且必须落在六边形中心上。
- **横向偏移由 cell 的 Y 奇偶决定**，不是行下标的奇偶 —— 见 `src/format/hex.ts`。
- **1 世界单位 = 100 像素**，客户端 `SetSize` 用的是整数除法 `width / 100`。
  `Loop` 地图的底图宽度必须正好等于 `列数 × 100`，否则左右复制的两份会错位。
- **底图与网格尺寸不一致是正常的**，除了上面那条 Loop 约束。现网两张图都不一致：
  `operation` 的底图每侧宽出 4.5 格，`global` 的底图比网格矮 6.46 格（露出来的
  南北极行正是障碍掩膜 `outsideValue = 1` 的由来）。整数除法的截断量只有 0.03 格，
  与这种美术出血差三个数量级，**不是**对齐问题的成因。侧栏「底图」区有对齐读数，
  工具栏「对齐框」可以把两个边界描出来比对。
- **`ImageSize` / `ImageTextureFormat` 是旧 ACME 的遗留字段**，客户端未声明、
  反序列化时静默忽略。本工具读入时容忍、写出时丢弃。
- **基地名必须是客户端 `GameInitialData` 里的 9 个之一**
  （`America` `Japan` `China` `Germany` `Italy` `France` `England` `Russia` `META`），
  且客户端 `HandleHealthDataStrategy` 是无保护取值，缺 key 会在对局中途抛异常。

### 操作

| 操作 | 方式 |
| --- | --- |
| 平移 | 浏览工具拖拽，或任意工具下按住中键 |
| 缩放 | 滚轮 |
| 涂障碍 / 擦除 | `B` / `E`，笔刷半径 0–4 |
| 放置基地 / 灯塔 | 工具栏按钮，点击落点 |
| 选择 / 移动 / 删除 | `S`，拖动移动，`Delete` 删除，右键取消选择 |
| 改名 | 在侧栏列表里选中该项，就地改 |
| 放置标注 | `T`，选中后在侧栏改文本/字号/颜色 |
| 比对底图对齐 | 工具栏「对齐框」，粉框=底图边界，绿框=网格边界 |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z`、`Ctrl+Y` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |

Chrome/Edge 下「保存」是**原地写回**原文件；Firefox/Safari 没有
File System Access API，退回浏览器下载。

### 从零做一张新图

1. 「从底图新建」选一张 PNG —— 网格尺寸按 `floor(宽/100)` 自动推算
2. 侧栏「从底图生成障碍」得到初稿（与 global 手绘网格一致率约 96%）
3. 用障碍笔/橡皮修剩下那几个百分点，主要是小到放不下一格的岛屿与海岸线
4. 放基地、灯塔、标注
5. `Ctrl+S` 存盘
