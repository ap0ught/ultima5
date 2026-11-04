/**
 * pageHooks.ts
 *
 * What the game asks of the page (game.ts GameHooks): settings applied to
 * the page (scanlines, sound), the clipboard and files a saved game is
 * carried by (game/transfer.ts), the installed files forgotten, the map
 * shown. And the controllers: a gamepad, and the touch pad on a touch.
 */

import { INPUT_PACES } from './holds.ts';
import type { Game } from '../game/game.ts';
import { LOST_FOCUS, Pad } from '../game/io.ts';
import { effectsOf, saveOptions, soundtrackOf, type Options } from '../game/settings.ts';
import { avatarName, fromBase64, parseSave } from '../game/storage.ts';
import { Save } from '../game/save.ts';
import { partyFigures } from '../game/world.ts';
import { clearInstalled } from '../install/store.ts';
import { GamepadInput } from './gamepad.ts';
import type { CapacitorLike } from './platform.ts';
import { mapKey, showMap } from './mapView.ts';
import { menuUp } from './pageMenu.ts';
import { ScanlineOverlay } from './scanlines.ts';
import { addressedAsLady, validAppearance } from '../game/appearance.ts';
import { handsOf } from '../game/switchWeapon.ts';
import type { Screen } from './screen.ts';
import type { PcSound } from './sound.ts';
import { fullScreen } from './fullScreen.ts';
import { TouchPad } from './touch.ts';

const PAD_KEY = 'ultima5.touchpad';

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage refused */
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The page's own box, while one is up (a line of text, a dialog): a controller's A and B answer it - OK and Cancel -
 * as they answer the game's own boxes, and its other buttons are held from the game until it goes.
 */
let pageBox: ((code: number) => void) | null = null;

/**
 * A line of text from the device's own keyboard: a box high on the page, so a phone's keyboard coming up from the
 * bottom leaves it in sight - its field focused, which is what brings that keyboard up. Enter or OK takes it, Escape
 * or Cancel puts it by (null). The game's font has only the plain letters: anything else is left out.
 */
function textBox(title: string, value: string, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:30;background:rgba(0,0,0,0.6);font:18px monospace;color:#fff;';
    const box = document.createElement('form');
    box.style.cssText =
      'position:absolute;left:50%;top:max(12px,6vh);transform:translateX(-50%);background:#000;border:3px solid #b5693a;' +
      'border-radius:6px;padding:14px 16px;width:min(90vw,24em);box-sizing:border-box;';
    const label = document.createElement('label');
    label.textContent = title;
    label.style.cssText = 'display:block;margin-bottom:10px;';
    const input = document.createElement('input');
    Object.assign(input, { type: 'text', value, maxLength: max, autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('enterkeyhint', 'done');
    input.style.cssText =
      'width:100%;box-sizing:border-box;font:22px monospace;padding:6px;background:#111;color:#fff;border:1px solid #888;';
    label.appendChild(input);
    box.appendChild(label);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;';
    const done = (text: string | null): void => {
      pageBox = null;
      back.remove();
      resolve(text === null ? null : text.replace(/[^\x20-\x7e]/g, '').slice(0, max));
    };
    pageBox = (code) => {
      if (code === Pad.A) done(input.value);
      else if (code === Pad.B) done(null);
    };
    for (const [name, submit] of [
      ['Cancel', false],
      ['OK', true],
    ] as const) {
      const b = document.createElement('button');
      b.type = submit ? 'submit' : 'button';
      b.textContent = name;
      b.style.cssText = 'font:18px monospace;padding:6px 14px;background:#222;color:#fff;border:1px solid #888;';
      if (!submit) b.onclick = () => done(null);
      row.appendChild(b);
    }
    box.appendChild(row);
    box.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
    });
    back.appendChild(box);
    document.body.appendChild(back);
    input.focus();
    input.select();
  });
}

/** A plain dialog over the game: a message, a text box to paste into (or not), and buttons. */
function dialog(message: string, paste: boolean, buttons: string[]): Promise<{ button: string; text: string }> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.style.cssText =
      'position:fixed;inset:0;z-index:30;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;font:16px monospace;color:#fff;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#000;border:2px solid #5555ff;padding:16px;max-width:90vw;width:32em;';
    const p = document.createElement('p');
    p.textContent = message;
    p.style.whiteSpace = 'pre-wrap';
    box.appendChild(p);
    let area: HTMLTextAreaElement | null = null;
    if (paste) {
      area = document.createElement('textarea');
      area.style.cssText = 'width:100%;height:8em;background:#000;color:#fff;border:1px solid #aaa;';
      box.appendChild(area);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;';
    const done = (button: string): void => {
      pageBox = null;
      back.remove();
      resolve({ button, text: area?.value ?? '' });
    };
    // A: the last button, the one the dialog is for (Import); B: Cancel, or the first.
    pageBox = (code) => {
      if (code === Pad.A) done(buttons[buttons.length - 1]);
      else if (code === Pad.B) done(buttons.includes('Cancel') ? 'Cancel' : buttons[0]);
    };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b;
      el.style.cssText = 'font:inherit;background:#0000aa;color:#fff;border:1px solid #fff;padding:4px 12px;cursor:pointer;';
      el.addEventListener('click', () => done(b));
      row.appendChild(el);
    }
    box.appendChild(row);
    back.appendChild(box);
    back.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(back);
    (area ?? row.querySelector('button'))?.focus();
  });
}

/** A file the player picks, read; '' when they pick none (the ultima3 port's picker). */
function pickFile(): Promise<string | Uint8Array> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.png,.txt,application/json,image/png,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (value: string | Uint8Array): void => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return finish('');
      const read = f.name.toLowerCase().endsWith('.png') ? f.arrayBuffer().then((bytes) => new Uint8Array(bytes)) : f.text();
      read.then(finish, (e: unknown) => {
        done = true;
        input.remove();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
    input.addEventListener('cancel', () => finish(''));
    // A browser without the cancel event: the window has its focus back when the picker closes, and a file picked
    // has arrived by then.
    window.addEventListener('focus', () => setTimeout(() => !input.files?.length && finish(''), 1500), { once: true });
    input.click();
  });
}

type DesktopExports = {
  reserve: (name: string) => Promise<string | null>;
  write?: (name: string, bytes: ArrayBuffer | Uint8Array) => Promise<string | null>;
};

/** The Electron bridge's binary path, kept separate so the desktop path is testable without a browser download. */
export function desktopSave(native: DesktopExports | undefined): ((contents: Blob, name: string) => Promise<string>) | null {
  const write = native?.write;
  if (!write) return null;
  return async (contents, name) => {
    const actualName = await native.reserve(name);
    if (!actualName) throw new Error('No unused export filename is available');
    const written = await write(actualName, new Uint8Array(await contents.arrayBuffer()));
    if (!written) throw new Error('The image could not be written');
    return written;
  };
}

/** `text` saved as a file named `name`, by the browser's download. */
async function saveFile(contents: string | Blob, name: string): Promise<string> {
  const native = (window as { u5native?: { exports?: DesktopExports } }).u5native?.exports;
  const desktop = contents instanceof Blob ? desktopSave(native) : null;
  if (desktop && contents instanceof Blob) return desktop(contents, name);
  const actualName = native ? await native.reserve(name) : name;
  if (!actualName) throw new Error('No unused export filename is available');
  const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
  const url = URL.createObjectURL(contents instanceof Blob ? contents : new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = actualName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return actualName;
}

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Add an uncompressed UTF-8 iTXt chunk after IHDR so the PNG remains a normal viewable image. */
async function pngWithSave(pngUrl: string, text: string): Promise<Blob> {
  const source = new Uint8Array(await (await fetch(pngUrl)).arrayBuffer());
  const encoder = new TextEncoder();
  const keyword = encoder.encode('Ultima5Save');
  const payload = new Uint8Array(keyword.length + 5 + encoder.encode(text).length);
  payload.set(keyword, 0);
  payload[keyword.length] = 0; // keyword terminator
  payload[keyword.length + 1] = 0; // uncompressed
  payload[keyword.length + 2] = 0; // compression method
  payload[keyword.length + 3] = 0; // language tag terminator
  payload[keyword.length + 4] = 0; // translated keyword terminator
  payload.set(encoder.encode(text), keyword.length + 5);
  const type = encoder.encode('iTXt');
  const chunk = new Uint8Array(12 + payload.length);
  new DataView(chunk.buffer).setUint32(0, payload.length);
  chunk.set(type, 4);
  chunk.set(payload, 8);
  new DataView(chunk.buffer).setUint32(8 + payload.length, pngCrc(new Uint8Array(chunk.buffer, 4, 4 + payload.length)));
  // PNG signature (8) + IHDR (4 length, 4 type, 13 data, 4 CRC).
  const out = new Uint8Array(source.length + chunk.length);
  out.set(source.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(source.subarray(33), 33 + chunk.length);
  return new Blob([out], { type: 'image/png' });
}

/** Render the active party with the engine's StandardArt figures into a portable PNG. */
async function engineCharacterImage(g: Game, screen: Screen, text: string): Promise<Blob> {
  const art = screen.characterArt;
  if (!art) throw new Error('Character image export requires the game character art to be loaded');
  const save = parseSave(text);
  const label = avatarName(save) || 'The nameless';
  const imageGame = Object.create(g) as Game;
  imageGame.s = new Save(fromBase64(save.save));
  imageGame.appearance = validAppearance(save.appearance);
  imageGame.companionLooks = new Map(Object.entries(save.companions ?? {}));
  const classNames: Record<string, string> = {
    A: 'Avatar',
    M: 'Mage',
    B: 'Bard',
    F: 'Fighter',
    D: 'Druid',
    T: 'Tinker',
    P: 'Paladin',
    R: 'Ranger',
    S: 'Shepherd',
  };
  const itemNames = g.data.table(0x17f6, 0x30);
  const members = partyFigures(imageGame, true);
  const saveMembers = imageGame.s.members.slice(0, imageGame.s.partySize);
  const memberNames = saveMembers.map((member, i) => member.name?.trim() || (i === 0 ? label : 'Unnamed'));
  const card = document.createElement('canvas');
  card.width = 800;
  card.height = 600;
  const ctx = card.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#171522';
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.strokeStyle = '#d7b56d';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, card.width - 36, card.height - 36);
  ctx.fillStyle = '#f4d99b';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 400, 72);
  ctx.fillStyle = '#c8bfd8';
  ctx.font = '24px sans-serif';
  ctx.fillText(`${members.length} party members`, 400, 108);
  ctx.imageSmoothingEnabled = false;
  const cell = document.createElement('canvas');
  const pixelsSide = Math.sqrt(art.figure(0).length);
  cell.width = pixelsSide;
  cell.height = pixelsSide;
  const cellCtx = cell.getContext('2d') as CanvasRenderingContext2D;
  const columnWidth = card.width / Math.max(1, members.length);
  const fitCentered = (value: string, center: number, y: number, maxWidth: number, font: string): void => {
    ctx.font = font;
    let size = Number(font.match(/\d+/)?.[0] ?? 14);
    while (ctx.measureText(value).width > maxWidth && size > 10) {
      size--;
      ctx.font = `${size}px sans-serif`;
    }
    ctx.fillText(value, center, y);
  };
  try {
    g.draw.avatar?.(imageGame.appearance, addressedAsLady(imageGame));
    members.forEach((member, i) => {
      screen.draw.dressAs?.(member.dress ?? null);
      const pixels = art.figure(member.tile);
      screen.draw.dressAs?.(null);
      cellCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), pixelsSide, pixelsSide), 0, 0);
      const center = (i + 0.5) * columnWidth;
      const x = center - 64;
      const y = 170 + Math.floor(i / 4) * 180;
      ctx.drawImage(cell, x, y, 128, 128);
      ctx.fillStyle = '#c8bfd8';
      fitCentered(memberNames[i] ?? `Member ${i + 1}`, center, y + 154, columnWidth - 20, '18px sans-serif');
      const saveMember = saveMembers[i];
      const cls = classNames[String.fromCharCode(saveMember?.cls ?? 0)] ?? 'Unknown';
      ctx.fillStyle = '#d7b56d';
      fitCentered(`${cls} · Level ${saveMember?.level ?? '?'}`, center, y + 174, columnWidth - 20, '14px sans-serif');
      const held = saveMember
        ? handsOf(imageGame, i)
            .map((item) => (itemNames[item] ?? '').replace(/^[*!(].*?\\s?/, '').trim())
            .filter(Boolean)
        : [];
      fitCentered(`Holding: ${held.length ? held.join(', ') : 'Nothing'}`, center, y + 194, columnWidth - 20, '14px sans-serif');
    });
    const savedAt = new Date(save.written).toLocaleString();
    ctx.fillText(`Saved ${savedAt}`, 400, 560);
    const png = card.toDataURL('image/png');
    return pngWithSave(png, text);
  } finally {
    screen.draw.dressAs?.(null);
    g.draw.avatar?.(g.appearance, addressedAsLady(g));
  }
}

/** The Android app's GameFolder plugin, its half for Export (mobile/.../GameFolderPlugin.java saveFile). */
interface GameFile {
  saveFile(o: { text: string; name: string }): Promise<{ name: string } | { cancelled: true }>;
}

/**
 * Export's To a file in the Android app, whose web view downloads nothing: Android's own picker for where the file
 * goes, opened at the name offered, the game written there by the app. Null outside the Android app (or an app built
 * before it could), where the browser's download does.
 */
export function androidSave(capacitor: unknown): ((text: string, name: string) => Promise<string | null>) | null {
  const cap = capacitor as { getPlatform?: () => string; Plugins?: { GameFolder?: Partial<GameFile> } } | undefined;
  const plugin = cap?.getPlatform?.() === 'android' ? cap.Plugins?.GameFolder : undefined;
  if (!plugin?.saveFile) return null;
  return async (text, name) => {
    const got = await (plugin as GameFile).saveFile({ text, name });
    return 'cancelled' in got ? null : got.name;
  };
}

/** How long after the last press Battery saver lets the map rest. */
export const BATTERY_SAVER_REST_MS = 60_000;

export function installPageHooks(g: Game, screen: Screen, canvas: HTMLCanvasElement, tiles: Uint8Array, sound: PcSound): void {
  const native = Boolean((window as { Capacitor?: CapacitorLike }).Capacitor?.isNativePlatform?.());
  const desktopFiles = (window as {
    u5native?: { importFiles?: { list: () => Promise<string[]>; read: (name: string) => Promise<string | null> } };
  }).u5native?.importFiles;
  const scanlines = new ScanlineOverlay(canvas);
  // A tab nobody is looking at holds where it is, music and all, and takes up again when it comes back - unless
  // the pause menu is up, whose own hold outlives the window's return (the u3 port's two holds).
  // The Android app sent to the background is held too, by Capacitor's App plugin (pause, resume): its web view may
  // not be told the page is hidden, and would go on animating, and its sound on, unseen.
  let appAway = false;
  const awake = (): void => {
    const away = document.hidden || appAway;
    screen.setAwake(!away);
    sound.setHeld('focus', away);
  };
  document.addEventListener('visibilitychange', awake);
  // With Battery saver on, the map rests a minute after the last press (screen.ts waitKey), a frame is asked for only
  // when there is something to show (screen.ts lazyFrames), and a gamepad read only while one is connected.
  screen.restAfter = () => (g.options.batterySaver ? BATTERY_SAVER_REST_MS : null);
  screen.lazyFrames = () => g.options.batterySaver;
  screen.smoothMotion = () => g.options.smoothMotion;
  // (Set once the gamepad is: Battery saver turned off, it is read at every refresh again.)
  let wakeInput = (): void => undefined;
  // With Auto Pause on, a window that loses focus, or a page hidden, while the game waits for a command opens the
  // Pause menu there (the ultima3 port's), so the player comes back to the game held: another window in front on a
  // desktop, the Android app sent to the background (Capacitor's App plugin says so too, where the web view is not
  // told). Off (the default), the game waits at its prompt as it was - a hidden page is held all the same (awake).
  const away = (): void => {
    if (g.options.autoPause && g.awaitingCommand && !g.paused) screen.push(LOST_FOCUS, false);
  };
  window.addEventListener('blur', away);
  document.addEventListener('visibilitychange', () => document.hidden && away());
  const app = (window as { Capacitor?: { Plugins?: { App?: { addListener?: (e: string, f: () => void) => unknown } } } }).Capacitor?.Plugins
    ?.App;
  void app?.addListener?.('pause', () => {
    appAway = true;
    awake();
    away();
  });
  void app?.addListener?.('resume', () => {
    appAway = false;
    awake();
  });
  const apply = (o: Options): void => {
    wakeInput();
    screen.holds.pace = INPUT_PACES[o.maxInput];
    scanlines.enabled = o.tileSet === 'standard' ? o.scanlines : o.pcScanlines;
    g.soundOff = o.effectsLevel === 0;
    sound.setEffects(effectsOf(o.soundChoice), o.effectsLevel);
    sound.setMusicVoice(soundtrackOf(o.soundChoice));
    sound.setMusic(o.musicLevel);
    screen.setTileArt(o.tileSet, o.tileSet === 'standard' ? o.tiles : o.pcTiles, o.outlines);
    g.draw.avatar?.(g.appearance, addressedAsLady(g));
    g.viewDirty = 1;
  };
  // A tile set made after it was chosen (the first time it is): the map drawn again in it.
  screen.onTilesReady = () => void (g.viewDirty = 1);
  apply(g.options);
  // A press on a gamepad or the touch pad is a controller's: the game is put in controller mode if it was not,
  // since the letter commands would ignore every button (the ultima3 port's).
  const from = (source: 'gamepad' | 'touch'): void => {
    g.lastSource = source;
    if (g.options.input !== 'controller') {
      g.options.input = 'controller';
      saveOptions(g.options);
    }
  };
  window.addEventListener('keydown', () => (g.lastSource = 'keyboard'), true);
  // Held, a key that stands for a button does not repeat into a second press (and a second turn); the d-pad's do.
  screen.dropRepeat = (k) =>
    g.options.input === 'controller' &&
    (k === 0x0d || k === 0x1b || k === 0x20 || 'ZXBCVYQE/.'.includes(String.fromCharCode(k).toUpperCase()));
  const send = (code: number, held = false): void => {
    // The crash box (ui/crash.ts), over everything, reads the gamepad itself: nothing beneath it is answered.
    if (menuUp()) return;
    // While a box of the page's own is up, it is the controller's to answer.
    if (pageBox) return pageBox(code);
    // While the map is showing, the controller and touch pad drive it (zoom, move, close).
    if (mapKey(code)) return;
    screen.push(code, true, held);
  };
  const gamepad = new GamepadInput(
    (code, held) => {
      touch.show(false);
      from('gamepad');
      send(code, held);
    },
    () => g.options.batterySaver,
    screen.holds,
  );
  wakeInput = () => gamepad.wake();
  const touch = new TouchPad({
    send,
    holds: screen.holds,
    onPress: () => from('touch'),
    onToggle: (shown) => remember(PAD_KEY, shown ? '1' : '0'),
    shown: recall(PAD_KEY) === '1',
    fullScreen: fullScreen(),
  });
  g.hooks = {
    applyOptions: apply,
    transfer: {
      copy: (text) => navigator.clipboard.writeText(text),
      copyImage: async (text) => {
        const image = await engineCharacterImage(g, screen, text);
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      },
      paste: () => navigator.clipboard.readText(),
      async pasteBox() {
        const r = await dialog('The clipboard cannot be read here. Paste the saved game below.', true, ['Cancel', 'Import']);
        screen.flushKeys();
        return r.button === 'Import' ? r.text : null;
      },
      // The Android app's web view downloads nothing: there the app saves the file itself (androidSave). A web view
      // without that offers the clipboard only.
      save: native ? androidSave((window as { Capacitor?: unknown }).Capacitor) ?? undefined : saveFile,
      saveImage: native
        ? undefined
        : async (text, name) => {
            const image = await engineCharacterImage(g, screen, text);
            const saved = await saveFile(image, name);
            return saved;
          },
      // A file input works in the Android app as in a browser: Capacitor's web view opens the system's picker for it.
      list: desktopFiles?.list,
      read: desktopFiles
        ? async (name) => {
            const text = await desktopFiles.read(name);
            if (text === null) throw new Error('file disappeared');
            return text;
          }
        : undefined,
      open: pickFile,
    },
    async uninstall() {
      await clearInstalled();
      location.reload();
    },
    async showMap(underworld, focus) {
      await showMap(g, tiles, underworld, () => screen.flushKeys(), screen.standardArt, focus);
    },
    async askText(title, value, max) {
      const text = await textBox(title, value, max);
      screen.flushKeys();
      return text;
    },
  };
}
