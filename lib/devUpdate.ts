/**
 * Unpacked installs only: notice when the files on disk are a newer build than
 * the one Chrome has loaded. An extension can read its own manifest.json from
 * disk; chrome.runtime.getManifest() is the copy loaded at start. If they differ,
 * the folder was updated. Store installs have an update_url and skip all of this.
 */
export async function newerBuildOnDisk(): Promise<boolean> {
  const loaded = chrome.runtime.getManifest();
  if ('update_url' in loaded) return false;
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = (await res.json()) as { version_name?: string };
    return typeof onDisk.version_name === 'string' && onDisk.version_name !== loaded.version_name;
  } catch {
    return false; // mid-write or unreadable: try again later
  }
}
