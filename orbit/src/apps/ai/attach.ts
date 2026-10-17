/**
 * Photos and files you add to a chat message. Photos are shrunk on this device (so they send fast
 * and fit in the chat history); text files are read as text. Nothing is uploaded anywhere but your
 * own AI machine, and only when you send.
 */
export type Attachment =
  | { kind: 'image'; name: string; dataUrl: string }
  | { kind: 'file'; name: string; text: string };

export const MAX_FILE_CHARS = 120_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|log|env\.example|gitignore|dockerfile)$/i;

export function isTextFile(f: { name: string; type: string }) {
  return f.type.startsWith('text/') || /json|xml|javascript|typescript|yaml|csv/.test(f.type) || TEXT_EXT.test(f.name);
}

/** Shrink a photo to at most `max` px on its longest side, as a JPEG data URL. */
export async function shrinkImage(file: Blob, max = 1280, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That picture could not be opened.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare pictures.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith('image/')) return { kind: 'image', name: file.name || 'photo', dataUrl: await shrinkImage(file) };
  if (isTextFile(file)) {
    const text = await file.text();
    if (text.length > MAX_FILE_CHARS) throw new Error(`${file.name} is too long for a chat (over ${Math.round(MAX_FILE_CHARS / 1000)}k characters).`);
    return { kind: 'file', name: file.name, text };
  }
  throw new Error(`${file.name}: only photos and text or code files can be added here. Use the full playground for PDFs and documents.`);
}

/** The text a model sees for attached files: each in a labelled block before your message. */
export function withFiles(text: string, files: { name: string; text: string }[] = []) {
  if (!files.length) return text;
  const blocks = files.map((f) => `File: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n');
  return `${blocks}\n\n${text}`;
}
