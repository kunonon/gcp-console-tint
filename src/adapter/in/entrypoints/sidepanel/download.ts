// Local calendar date, not UTC: the file name should read as the day the user pressed Export.
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Downloads `text` straight from a blob URL (no downloads permission needed).
export function downloadJson(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  // Attached for the click and released on the next tick: Firefox only honors `download` on an
  // anchor that is in the document, and revoking the blob URL synchronously can cut off a
  // download that has not started yet. Released even if the caller is gone by then.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
