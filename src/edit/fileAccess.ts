/**
 * 文件读写。
 *
 * 支持 File System Access API 的浏览器（Chrome/Edge）可以原地保存 ——
 * 反复「另存为」会在下载目录里堆一串 `xxx (1).azurchessmap`，做地图时
 * 会不断存盘，这个体验差别很大。
 * 不支持时（Firefox/Safari）自动退回到 `<input type=file>` + 下载。
 */

const MAP_TYPES = [
  { description: 'AzurChess 地图', accept: { 'application/zip': ['.azurchessmap'] } },
];

interface FileSystemAccess {
  showOpenFilePicker(options?: unknown): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: unknown): Promise<FileSystemFileHandle>;
}

function api(): FileSystemAccess | null {
  const w = window as unknown as Partial<FileSystemAccess>;
  return typeof w.showSaveFilePicker === 'function' ? (w as FileSystemAccess) : null;
}

export const supportsFileSystemAccess = (): boolean => api() !== null;

export interface OpenedFile {
  file: File;
  /** 支持原地保存时带回句柄，否则为 null。 */
  handle: FileSystemFileHandle | null;
}

/** 打开地图。返回 null 表示用户取消。 */
export async function openMap(): Promise<OpenedFile | null> {
  const fs = api();
  if (!fs) return null; // 调用方退回到 <input type=file>
  try {
    const [handle] = await fs.showOpenFilePicker({ types: MAP_TYPES, multiple: false });
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** 写回已有句柄。 */
export async function writeToHandle(
  handle: FileSystemFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes as unknown as BufferSource);
  await writable.close();
}

/** 另存为，返回新句柄；取消时返回 null。 */
export async function saveMapAs(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  const fs = api();
  if (!fs) {
    downloadBytes(bytes, suggestedName);
    return null;
  }
  try {
    const handle = await fs.showSaveFilePicker({ suggestedName, types: MAP_TYPES });
    await writeToHandle(handle, bytes);
    return handle;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** 退路：触发一次浏览器下载。 */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
