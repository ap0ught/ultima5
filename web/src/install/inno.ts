// @ts-expect-error The generated Emscripten module has no source declaration.
import ModuleFactory from './innoextract/innoextract.js';
import { readZip, type ZipEntry } from './zip.ts';

// The generated module is Emscripten's browser build of innoextract. It reads
// the selected installer through this File-like object and writes its output
// as ZIP chunks through Module.writer.
type InnoModule = {
  set_options(options: string): void;
  load_exe(path: string): Promise<string> | string;
  list_files(): Promise<string> | string;
  extract(files: string): Promise<string> | string;
  writer?: { ready?: Promise<void>; write(chunk: Uint8Array): Promise<void>; close(): void };
};

type TreeNode = { fileId?: number; nodes?: TreeNode[] };

let ready: Promise<InnoModule> | undefined;
let extractionQueue: Promise<void> = Promise.resolve();

function module(): Promise<InnoModule> {
  if (!ready) {
    const global = globalThis as typeof globalThis & {
      innoLog?: (message: unknown) => void;
      innoErr?: (message: unknown) => void;
    };
    global.innoLog = () => undefined;
    global.innoErr = () => undefined;
    ready = (ModuleFactory as unknown as (options: Record<string, unknown>) => Promise<InnoModule>)({
      noInitialRun: true,
      print: global.innoLog,
      printErr: global.innoErr,
    });
  }
  return ready;
}

function parseResult<T>(value: unknown): T {
  const first = typeof value === 'string' ? JSON.parse(value) : value;
  return (typeof first === 'string' ? JSON.parse(first) : first) as T;
}
function fileIds(nodes: TreeNode[]): number[] {
  const ids: number[] = [];
  const visit = (node: TreeNode): void => {
    if (node.fileId !== undefined) ids.push(node.fileId);
    node.nodes?.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/** Extract an Inno Setup installer to the same candidates used by ZIP uploads. */
export function readInno(file: File): Promise<ZipEntry[]> {
  const operation = extractionQueue.then(async () => {
    (globalThis as typeof globalThis & { global_file_list?: File[] }).global_file_list = [file];

    const inno = await module();
    const chunks: Uint8Array[] = [];
    const writer = {
      ready: Promise.resolve(),
      write: async (chunk: Uint8Array): Promise<void> => {
        chunks.push(new Uint8Array(chunk));
      },
      close: () => undefined,
    };
    inno.writer = writer;
    inno.set_options(
      JSON.stringify({
        enableDebug: false,
        excludeTemps: true,
        logsToFile: false,
        extractionLanguageFilterOptions: 'all',
        collisionResolutionOptions: 'overwrite',
      }),
    );

    const loaded = parseResult<{ error?: string }>(await inno.load_exe(file.name));
    if (loaded.error) throw new Error(loaded.error);
    const tree = parseResult<TreeNode[]>(await inno.list_files());
    const result = parseResult<{ error?: string }>(await inno.extract(JSON.stringify({ files: fileIds(tree), dirs: [] })));
    if (result.error) throw new Error(result.error);
    writer.close();

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const zip = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      zip.set(chunk, offset);
      offset += chunk.length;
    }
    return readZip(zip);
  });
  extractionQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
