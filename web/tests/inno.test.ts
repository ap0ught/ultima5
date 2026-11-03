import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  factory: () => Promise.resolve({}),
}));

vi.mock('../src/install/innoextract/innoextract.js', () => ({
  default: () => mocks.factory(),
}));

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

function fakeModule(fail?: string) {
  const observed: unknown[] = [];
  const inno = {
    writer: undefined as { write(chunk: Uint8Array): Promise<void> } | undefined,
    set_options: () => undefined,
    load_exe: async (name: string): Promise<string> => {
      await delay();
      const files = (globalThis as typeof globalThis & { global_file_list?: unknown[] }).global_file_list;
      observed.push(files?.[0]);
      if (name === fail) throw new Error('unsupported installer');
      return '{}';
    },
    list_files: async (): Promise<string> => '[]',
    extract: async (): Promise<string> => {
      await delay();
      const files = (globalThis as typeof globalThis & { global_file_list?: File[] }).global_file_list;
      await inno.writer?.write(zipSync({ [files?.[0].name ?? '']: new Uint8Array() }));
      return '{}';
    },
  };
  return { inno, observed };
}

describe('Inno installer imports', () => {
  it('serializes access to the shared input and writer', async () => {
    vi.resetModules();
    const fake = fakeModule();
    mocks.factory = async () => fake.inno;
    const { readInno } = await import('../src/install/inno.ts');
    const first = new File([], 'first.exe');
    const second = new File([], 'second.exe');

    const [firstEntries, secondEntries] = await Promise.all([readInno(first), readInno(second)]);

    expect(fake.observed).toEqual([first, second]);
    expect(firstEntries.map((entry) => entry.path)).toEqual(['first.exe']);
    expect(secondEntries.map((entry) => entry.path)).toEqual(['second.exe']);
  });

  it('keeps the extraction queue usable after a failed import', async () => {
    vi.resetModules();
    const fake = fakeModule('unsupported.exe');
    mocks.factory = async () => fake.inno;
    const { readInno } = await import('../src/install/inno.ts');

    await expect(readInno(new File([], 'unsupported.exe'))).rejects.toThrow('unsupported installer');
    await expect(readInno(new File([], 'supported.exe'))).resolves.toMatchObject([{ path: 'supported.exe' }]);
  });
});
