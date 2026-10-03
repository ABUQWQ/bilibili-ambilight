/* Service worker for the Bilibili ambient-light probe.
 *
 * The content script collects the DOM report and drives the scroll loop; this
 * worker performs the two privileged steps that a content script cannot do:
 * chrome.tabs.captureVisibleTab() for the screenshot, and
 * chrome.downloads.download() to persist the PNG/JSON to disk.
 *
 * Everything is written under <Downloads>/bili-probe/ with fixed names so the
 * files can be read back without the user having to attach anything.
 */

const FOLDER = 'bili-probe';
const MAX_SHOTS = 10;
const ENDPOINT = 'http://127.0.0.1:8799';

/* Ship every artefact over both transports and report which ones worked.
   The loopback sink writes into the project workspace, which the agent can
   read directly; chrome.downloads writes into the user's Downloads folder,
   which is the durable copy and survives a restart of the helper. Trying both
   means a single working transport is enough. */
async function deliver(blob, name, fallbackUrl) {
  const via = [];
  const problems = [];

  try {
    const response = await fetch(
      `${ENDPOINT}/upload?name=${encodeURIComponent(name)}`,
      { method: 'POST', body: blob }
    );
    if (!response.ok) throw new Error(`loopback sink returned ${response.status}`);
    via.push('loopback');
  } catch (error) {
    problems.push(`loopback: ${String(error && error.message)}`);
  }

  if (fallbackUrl) {
    try {
    await saveUrl(fallbackUrl, name);
      via.push('downloads');
    } catch (error) {
      problems.push(`downloads: ${String(error && error.message)}`);
    }
  }

  if (!via.length) throw new Error(problems.join('; ') || 'no transport available');
  return { name, via, problems };
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(head);
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: (mime && mime[1]) || 'application/octet-stream' });
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function saveUrl(url, filename) {
  const id = await chrome.downloads.download({
    url,
    filename: `${FOLDER}/${filename}`,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  return id;
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') {
    return { ok: false, error: 'unknown message' };
  }

  if (message.type === 'capture') {
    const tab = sender.tab;
    if (!tab) return { ok: false, error: 'capture requires a content script' };
    const index = Number(message.index) || 0;
    if (index >= MAX_SHOTS) {
      return { ok: false, error: `shot budget ${MAX_SHOTS} exhausted` };
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
    });
    const name = `scroll-${String(index).padStart(2, '0')}.png`;
    const delivered = await deliver(dataUrlToBlob(dataUrl), name, dataUrl);
    return { ok: true, file: name, via: delivered.transport };
  }

  if (message.type === 'save-json') {
    const text = message.json || '{}';
    const url = `data:application/json;base64,${toBase64(text)}`;
    const name = message.name ? `${message.name}.json` : 'report.json';
    const delivered = await deliver(
      new Blob([text], { type: 'application/json' }),
      name,
      url
    );
    return { ok: true, file: name, via: delivered.transport };
  }

  return { ok: false, error: `unsupported message: ${message.type}` };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: String((error && error.message) || error) })
    );
  return true;
});
