// Streams (part of) a file into a response. The file is closed whatever happens: the response ends, fails, or the
// browser goes away halfway (a plain `.pipe()` would leave the file open then, and enough of those exhaust the server's
// file descriptors).
import { createReadStream, type ReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/** Sends the bytes of `path` in `range`; returns the file stream (tests watch it close). */
export function streamFile(res: ServerResponse, path: string, range: ByteRange): ReadStream {
  const file = createReadStream(path, range);
  pipeline(file, res, (error) => {
    // Nothing to report: a reader that left early is normal, and a file that cannot be read ends the response.
    if (error !== undefined && error !== null && !res.destroyed) res.destroy();
  });
  return file;
}
