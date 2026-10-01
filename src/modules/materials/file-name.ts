// Multer exposes multipart filenames as latin1 text even when browsers send
// UTF-8 bytes. Decode only valid UTF-8 byte sequences so legacy records and
// newly uploaded Chinese filenames display consistently.
export function normalizeUploadName(name: string): string {
  if ([...name].some((character) => character.codePointAt(0)! > 0xff))
    return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(name, "latin1"),
    );
  } catch {
    return name;
  }
}
