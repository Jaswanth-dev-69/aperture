import type { Macro } from "../types";

const KEY = "aperture_macros";

export async function getMacros(): Promise<Macro[]> {
  const result = await chrome.storage.local.get(KEY);
  return (result[KEY] as Macro[] | undefined) ?? [];
}

export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await getMacros();
  macros.push(macro);
  await chrome.storage.local.set({ [KEY]: macros });
}

export async function deleteMacro(id: string): Promise<void> {
  const macros = await getMacros();
  await chrome.storage.local.set({ [KEY]: macros.filter((m) => m.id !== id) });
}
