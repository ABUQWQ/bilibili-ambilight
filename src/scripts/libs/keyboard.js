export async function handleAmbientlightKeyDown(event) {
  if (!this.isOnVideoPage) return;
  const active = document.activeElement;
  if (active && (['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName) ||
      active.isContentEditable)) return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key?.toUpperCase();
  if (key === this.settings.getKeys().enabled) {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
  }
  await this.onKeyPressed(key);
}
