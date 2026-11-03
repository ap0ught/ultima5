/** The first connected pad in the Gamepad API's indexed list. */
export function firstConnectedPad<T extends { connected: boolean }>(
  pads: ArrayLike<T | null | undefined> | null | undefined,
): T | null {
  if (!pads) return null;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad?.connected) return pad;
  }
  return null;
}