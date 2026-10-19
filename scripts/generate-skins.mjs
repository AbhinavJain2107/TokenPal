import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PNG Encoder using standard zlib and raw PNG chunks
function createPng(width, height, getPixel) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  function calculateCrc(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const toCrc = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(calculateCrc(toCrc), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Colors
const C_TRANSPARENT = [0, 0, 0, 0];
const C_DARK = [30, 41, 59, 255]; // Slate dark #1e293b
const C_WHITE = [248, 250, 252, 255]; // Soft white #f8fafc
const C_PINK = [244, 114, 182, 255]; // Pink #f472b6
const C_Z = [147, 197, 253, 255]; // Light blue for z's
const C_ALERT = [239, 68, 68, 255]; // Red for ! #ef4444
const C_HEART = [236, 72, 153, 255]; // Magenta heart #ec4899
const C_QUESTION = [251, 191, 36, 255]; // Amber ? #fbbf24

// Particle helpers
function getSleepZPixel(sleepPhase, x, y) {
  if (sleepPhase === 1 || sleepPhase === 2) {
    const zY = 11 - sleepPhase * 2;
    const zX = 22 + sleepPhase;
    if ((y === zY && (x >= zX && x <= zX + 2)) ||
        (y === zY + 1 && x === zX + 1) ||
        (y === zY + 2 && (x >= zX && x <= zX + 2))) {
      return C_Z;
    }
  }
  return null;
}

function getAlertMarkPixel(frame, x, y) {
  if (frame === 13 || frame === 14) {
    if (y >= 2 && y <= 5 && x === 16) return C_ALERT;
    if (y === 7 && x === 16) return C_ALERT;
  }
  return null;
}

function getHappyHeartPixel(frame, x, y) {
  if (frame === 17 || frame === 18) {
    if ((y === 3 && (x === 23 || x === 25)) ||
        (y === 4 && x >= 23 && x <= 25) ||
        (y === 5 && x === 24)) {
      return C_HEART;
    }
  }
  return null;
}

function getCuriousQuestionPixel(frame, x, y) {
  if (frame === 21 || frame === 22) {
    // ? mark at x=23..25, y=3..7
    if ((y === 3 && x >= 23 && x <= 25) ||
        (y === 4 && x === 25) ||
        (y === 5 && x === 24) ||
        (y === 7 && x === 24)) {
      return C_QUESTION;
    }
  }
  return null;
}

// -------------------------------------------------------------
// 1. CAT PIXEL GENERATOR
// -------------------------------------------------------------
function getCatPixel(frame, x, y) {
  const C_ORANGE = [249, 115, 22, 255];
  const C_SHADOW = [234, 88, 12, 255];
  const C_EYE = [16, 185, 129, 255];

  // Sleep state (frames 8..11)
  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    const dx = x - 16;
    const dy = y - 22;
    if (dx * dx + dy * dy * 1.5 <= 64) {
      if (y === 17 && (x === 11 || x === 21)) return C_PINK;
      if (y === 21 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_DARK;
      if (y >= 23 && x >= 14 && x <= 18) return C_WHITE;
      return C_ORANGE;
    }
    if (y === 26 && x >= 8 && x <= 11) return C_SHADOW;
    return C_TRANSPARENT;
  }

  // Animation phase flags
  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;
  const isIdle = frame <= 3;

  // Particle checks
  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yBob = (isWalk && (frame - 4) % 2 === 1) ? -1 : 0;
  let pawOffset = isWalk ? ((frame - 4) === 0 ? -2 : ((frame - 4) === 2 ? 2 : 0)) : 0;
  let tilt = isCurious ? (frame >= 21 ? 1 : 0) : 0;

  const effY = y - yBob;
  const effX = x - tilt;

  // Ears
  if (effY >= 7 && effY <= 10 && effX >= 10 && effX <= 13) {
    if (effY - 7 >= effX - 10) {
      if (effY >= 8 && effY <= 9 && effX === 11) return C_PINK;
      return C_ORANGE;
    }
  }
  if (effY >= 7 && effY <= 10 && effX >= 18 && effX <= 21) {
    if (effY - 7 >= 21 - effX) {
      if (effY >= 8 && effY <= 9 && effX === 20) return C_PINK;
      return C_ORANGE;
    }
  }
  if (isAlert && effY === 6 && (effX === 11 || effX === 20)) return C_ORANGE;

  // Head circle: center (16, 14), radius 6
  const hdx = effX - 16;
  const hdy = effY - 14;
  if (hdx * hdx + hdy * hdy <= 36) {
    if (isAlert) {
      if (effY >= 13 && effY <= 15) {
        if ((effX >= 12 && effX <= 14) || (effX >= 18 && effX <= 20)) {
          if (effY === 14 && (effX === 13 || effX === 19)) return C_DARK;
          return C_WHITE;
        }
      }
    } else if (isHappy) {
      if (effY === 13 && (effX === 13 || effX === 19)) return C_DARK;
      if (effY === 14 && (effX === 12 || effX === 14 || effX === 18 || effX === 20)) return C_DARK;
    } else if (isCurious) {
      if (effY >= 12 && effY <= 14 && ((effX >= 12 && effX <= 14) || (effX >= 18 && effX <= 20))) {
        if (effY === 12) return C_EYE;
        return C_DARK;
      }
    } else if (isIdle && frame === 2) {
      if (effY === 14 && ((effX >= 12 && effX <= 14) || (effX >= 18 && effX <= 20))) return C_DARK;
    } else {
      if (effY >= 13 && effY <= 14 && ((effX >= 12 && effX <= 13) || (effX >= 18 && effX <= 19))) {
        if (effY === 13) return C_EYE;
        return C_DARK;
      }
    }

    if (effY === 16 && effX === 16) return C_PINK;
    if (effY >= 16 && effY <= 17 && effX >= 14 && effX <= 18 && !(effY === 16 && effX === 16)) return C_WHITE;
    return C_ORANGE;
  }

  // Whiskers
  if (effY === 16 && (effX === 9 || effX === 10 || effX === 22 || effX === 23)) return C_DARK;
  if (effY === 17 && (effX === 8 || effX === 10 || effX === 22 || effX === 24)) return C_DARK;

  // Body
  if (effY >= 19 && effY <= 28) {
    const bdx = x - 16;
    const bdy = effY - 24;
    if (bdx * bdx * 1.2 + bdy * bdy <= 38) {
      if (x >= 14 && x <= 18 && effY >= 19 && effY <= 26) return C_WHITE;
      return C_ORANGE;
    }
  }

  // Paws
  if (effY === 28) {
    if (isWalk) {
      if (x >= 12 + pawOffset && x <= 14 + pawOffset) return C_WHITE;
      if (x >= 18 - pawOffset && x <= 20 - pawOffset) return C_WHITE;
    } else {
      if ((x >= 12 && x <= 14) || (x >= 18 && x <= 20)) return C_WHITE;
    }
  }

  // Tail
  if (isAlert) {
    if (x === 24 && effY >= 16 && effY <= 26) return C_SHADOW;
    if (effY === 15 && (x === 24 || x === 25)) return C_SHADOW;
  } else if (isHappy) {
    const tx = 24 + ((frame - 16) % 2);
    if (effY >= 18 && effY <= 26 && x === tx) return C_SHADOW;
  } else {
    const tailWiggle = isIdle ? (frame % 2) : 0;
    if (effY === 27 && x >= 21 && x <= 24 + tailWiggle) return C_SHADOW;
    if (effY === 26 && x === 24 + tailWiggle) return C_SHADOW;
  }

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// 2. DOG PIXEL GENERATOR (Golden puppy with floppy ears)
// -------------------------------------------------------------
function getDogPixel(frame, x, y) {
  const C_BROWN = [217, 119, 6, 255]; // Golden brown #d97706
  const C_DARK_BROWN = [180, 83, 9, 255]; // Darker brown #b45309
  const C_NOSE = [15, 23, 42, 255];

  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    const dx = x - 16;
    const dy = y - 23;
    if (dx * dx + dy * dy * 1.3 <= 64) {
      if (y === 22 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_DARK;
      if (y === 23 && x === 16) return C_NOSE;
      if (y >= 23 && x >= 14 && x <= 18) return C_WHITE;
      return C_BROWN;
    }
    // Floppy ear sleeping flat
    if (y >= 20 && y <= 24 && (x === 9 || x === 10 || x === 22 || x === 23)) return C_DARK_BROWN;
    return C_TRANSPARENT;
  }

  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;

  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yBob = (isWalk && (frame - 4) % 2 === 1) ? -1 : 0;
  let pawOffset = isWalk ? ((frame - 4) === 0 ? -2 : ((frame - 4) === 2 ? 2 : 0)) : 0;
  let earBounce = isWalk ? ((frame - 4) % 2) : 0;
  let tilt = isCurious ? (frame >= 21 ? 1 : 0) : 0;

  const effY = y - yBob;
  const effX = x - tilt;

  // Floppy ears on the sides of the head
  // Left ear: hangs down from y=9 to y=17 at x=8..10
  if (effX >= 8 && effX <= 10 && effY >= 9 - earBounce && effY <= 17 - earBounce) {
    return C_DARK_BROWN;
  }
  // Right ear: hangs down from y=9 to y=17 at x=22..24
  if (effX >= 22 && effX <= 24 && effY >= 9 - earBounce && effY <= 17 - earBounce) {
    return C_DARK_BROWN;
  }

  // Head: center (16, 13), radius 6
  const hdx = effX - 16;
  const hdy = effY - 13;
  if (hdx * hdx + hdy * hdy <= 36) {
    // Eyes
    if (isAlert) {
      if (effY >= 12 && effY <= 14 && ((effX >= 12 && effX <= 14) || (effX >= 18 && effX <= 20))) {
        if (effY === 13 && (effX === 13 || effX === 19)) return C_DARK;
        return C_WHITE;
      }
    } else if (isHappy) {
      if (effY === 12 && (effX === 13 || effX === 19)) return C_DARK;
      if (effY === 13 && (effX === 12 || effX === 14 || effX === 18 || effX === 20)) return C_DARK;
    } else {
      if (effY >= 12 && effY <= 13 && ((effX >= 13 && effX <= 14) || (effX >= 18 && effX <= 19))) return C_DARK;
    }

    // Cute dark dog nose
    if (effY === 15 && (effX === 15 || effX === 16 || effX === 17)) return C_NOSE;
    if (effY === 16 && effX === 16) return C_NOSE;

    // Happy panting tongue
    if (isHappy && effY >= 16 && effY <= 17 && effX === 16) return C_PINK;

    // White muzzle patch
    if (effY >= 15 && effY <= 17 && effX >= 14 && effX <= 18) return C_WHITE;

    return C_BROWN;
  }

  // Body
  if (effY >= 19 && effY <= 28) {
    const bdx = x - 16;
    const bdy = effY - 24;
    if (bdx * bdx * 1.1 + bdy * bdy <= 40) {
      if (x >= 14 && x <= 18 && effY >= 19 && effY <= 25) return C_WHITE;
      return C_BROWN;
    }
  }

  // Paws
  if (effY === 28) {
    if (isWalk) {
      if (x >= 12 + pawOffset && x <= 14 + pawOffset) return C_WHITE;
      if (x >= 18 - pawOffset && x <= 20 - pawOffset) return C_WHITE;
    } else {
      if ((x >= 12 && x <= 14) || (x >= 18 && x <= 20)) return C_WHITE;
    }
  }

  // Wagging Tail
  const wag = (frame % 2 === 0) ? 0 : 2;
  if (effY === 24 && (x === 24 + wag || x === 25 + wag)) return C_DARK_BROWN;
  if (effY === 23 && (x === 25 + wag || x === 26 + wag)) return C_DARK_BROWN;

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// 3. HAMSTER PIXEL GENERATOR (Chubby golden hamster with puffed cheeks)
// -------------------------------------------------------------
function getHamsterPixel(frame, x, y) {
  const C_BEIGE = [245, 158, 11, 255]; // Golden amber #f59e0b
  const C_CREAM = [254, 243, 199, 255]; // Soft cream #fef3c7

  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    // Complete round sleeping ball
    const dx = x - 16;
    const dy = y - 23;
    if (dx * dx + dy * dy <= 49) {
      if (y === 22 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_DARK;
      if (y >= 23 && x >= 14 && x <= 18) return C_CREAM;
      return C_BEIGE;
    }
    return C_TRANSPARENT;
  }

  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;

  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yBob = isWalk ? ((frame - 4) % 2 === 1 ? -1 : 0) : 0;
  const effY = y - yBob;

  // Tiny round ears: x=10..12, y=8..10 and x=20..22, y=8..10
  if ((effY >= 9 && effY <= 11) && ((x >= 10 && x <= 12) || (x >= 20 && x <= 22))) {
    if (effY === 10 && (x === 11 || x === 21)) return C_PINK;
    return C_BEIGE;
  }

  // Round chubby body & head combined: center (16, 18), radius 8
  const dx = x - 16;
  const dy = effY - 18;
  if (dx * dx * 0.9 + dy * dy <= 64) {
    // Chubby cheek bulges
    if (effY >= 16 && effY <= 19 && (x === 9 || x === 23)) return C_CREAM;

    // Eyes
    if (isAlert) {
      if (effY >= 14 && effY <= 16 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) {
        if (effY === 15 && (x === 13 || x === 19)) return C_DARK;
        return C_WHITE;
      }
    } else if (isHappy) {
      if (effY === 14 && (x === 13 || x === 19)) return C_DARK;
      if (effY === 15 && (x === 12 || x === 14 || x === 18 || x === 20)) return C_DARK;
    } else {
      if (effY >= 14 && effY <= 15 && ((x >= 13 && x <= 14) || (x >= 18 && x <= 19))) return C_DARK;
    }

    // Tiny pink nose & mouth
    if (effY === 17 && x === 16) return C_PINK;
    if (effY >= 17 && effY <= 19 && x >= 14 && x <= 18 && !(effY === 17 && x === 16)) return C_CREAM;

    // Big cream belly
    if (effY >= 20 && effY <= 25 && x >= 13 && x <= 19) return C_CREAM;

    // Paws holding sunflower seed
    if (effY === 21 && (x === 14 || x === 18)) return C_PINK;
    if (isHappy && effY === 21 && (x === 15 || x === 16 || x === 17)) return C_DARK; // sunflower seed

    return C_BEIGE;
  }

  // Tiny feet
  if (effY === 26) {
    if ((x >= 11 && x <= 13) || (x >= 19 && x <= 21)) return C_PINK;
  }

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// 4. RABBIT PIXEL GENERATOR (Snow bunny with tall ears & pink nose)
// -------------------------------------------------------------
function getRabbitPixel(frame, x, y) {
  const C_FUR = [241, 245, 249, 255]; // Snow white #f1f5f9
  const C_SHAD = [203, 213, 225, 255]; // Soft slate shadow #cbd5e1

  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    // Curled rabbit loaf
    const dx = x - 16;
    const dy = y - 23;
    if (dx * dx + dy * dy * 1.4 <= 56) {
      if (y === 22 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_DARK;
      if (y === 23 && x === 16) return C_PINK;
      return C_FUR;
    }
    // Folded ears back
    if (y >= 18 && y <= 20 && (x >= 11 && x <= 21)) return C_SHAD;
    // Tail puffball
    if (y === 23 && x === 8) return C_FUR;
    return C_TRANSPARENT;
  }

  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;

  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yHop = isWalk ? ((frame - 4) % 2 === 1 ? -2 : 0) : 0;
  let earTilt = isCurious ? (frame >= 21 ? 2 : 1) : 0;
  const effY = y - yHop;

  // Tall Bunny Ears (y=3..12)
  // Left ear
  if (effY >= 3 && effY <= 11 && x >= 11 - earTilt && x <= 13 - earTilt) {
    if (effY >= 5 && effY <= 9 && x === 12 - earTilt) return C_PINK;
    return C_FUR;
  }
  // Right ear
  if (effY >= 3 && effY <= 11 && x >= 19 + earTilt && x <= 21 + earTilt) {
    if (effY >= 5 && effY <= 9 && x === 20 + earTilt) return C_PINK;
    return C_FUR;
  }

  // Head: center (16, 15), radius 6
  const hdx = x - 16;
  const hdy = effY - 15;
  if (hdx * hdx + hdy * hdy <= 36) {
    if (isAlert) {
      if (effY >= 14 && effY <= 16 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) {
        if (effY === 15 && (x === 13 || x === 19)) return C_DARK;
        return C_WHITE;
      }
    } else if (isHappy) {
      if (effY === 14 && (x === 13 || x === 19)) return C_DARK;
      if (effY === 15 && (x === 12 || x === 14 || x === 18 || x === 20)) return C_DARK;
    } else {
      if (effY >= 14 && effY <= 15 && ((x >= 13 && x <= 14) || (x >= 18 && x <= 19))) return C_PINK;
    }

    // Bunny nose
    if (effY === 17 && x === 16) return C_PINK;
    return C_FUR;
  }

  // Body
  if (effY >= 20 && effY <= 28) {
    const bdx = x - 16;
    const bdy = effY - 24;
    if (bdx * bdx * 1.2 + bdy * bdy <= 36) {
      return C_FUR;
    }
  }

  // Puffball tail
  if (effY >= 24 && effY <= 26 && x >= 7 && x <= 9) return C_FUR;

  // Front paws
  if (effY === 28 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_SHAD;

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// 5. FOX PIXEL GENERATOR (Rust-red fox with white-tipped bushy tail)
// -------------------------------------------------------------
function getFoxPixel(frame, x, y) {
  const C_RUST = [234, 88, 12, 255]; // Rust red #ea580c
  const C_BLACK = [15, 23, 42, 255];

  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    const dx = x - 16;
    const dy = y - 23;
    if (dx * dx + dy * dy * 1.3 <= 56) {
      if (y === 22 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_DARK;
      return C_RUST;
    }
    // Curled big tail covering front
    if (y >= 21 && y <= 26 && x >= 7 && x <= 13) {
      if (x <= 9) return C_WHITE; // white tip
      return C_RUST;
    }
    return C_TRANSPARENT;
  }

  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;

  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yBob = isWalk ? ((frame - 4) % 2 === 1 ? -1 : 0) : 0;
  const effY = y - yBob;

  // Big Triangular Fox Ears with black tips (y=6..11)
  if (effY >= 6 && effY <= 10 && x >= 10 && x <= 13) {
    if (effY === 6 || effY === 7) return C_BLACK; // Black tip
    if (effY >= 8 && effY <= 9 && x === 11) return C_WHITE;
    return C_RUST;
  }
  if (effY >= 6 && effY <= 10 && x >= 19 && x <= 22) {
    if (effY === 6 || effY === 7) return C_BLACK; // Black tip
    if (effY >= 8 && effY <= 9 && x === 21) return C_WHITE;
    return C_RUST;
  }

  // Head: center (16, 14), radius 6
  const hdx = x - 16;
  const hdy = effY - 14;
  if (hdx * hdx + hdy * hdy <= 36) {
    // Eyes: sleek golden/amber
    if (isAlert) {
      if (effY >= 13 && effY <= 15 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) {
        if (effY === 14 && (x === 13 || x === 19)) return C_DARK;
        return C_WHITE;
      }
    } else if (isHappy) {
      if (effY === 13 && (x === 13 || x === 19)) return C_DARK;
      if (effY === 14 && (x === 12 || x === 14 || x === 18 || x === 20)) return C_DARK;
    } else {
      if (effY >= 13 && effY <= 14 && ((x >= 12 && x <= 13) || (x >= 18 && x <= 19))) return C_BLACK;
    }

    // Fox muzzle (pointed white with black nose)
    if (effY === 16 && x === 16) return C_BLACK;
    if (effY >= 16 && effY <= 17 && x >= 13 && x <= 19) return C_WHITE;
    return C_RUST;
  }

  // Body
  if (effY >= 19 && effY <= 28) {
    const bdx = x - 16;
    const bdy = effY - 24;
    if (bdx * bdx * 1.2 + bdy * bdy <= 38) {
      if (x >= 14 && x <= 18 && effY >= 19 && effY <= 25) return C_WHITE; // white bib
      return C_RUST;
    }
  }

  // Black paws
  if (effY === 28 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_BLACK;

  // Big Bushy Tail with white tip (x=22..28, y=17..27)
  const tailSway = isWalk ? ((frame - 4) % 2) : 0;
  if (effY >= 17 && effY <= 27 && x >= 23 + tailSway && x <= 28 + tailSway) {
    if (effY <= 19 || (effY === 20 && x >= 26)) return C_WHITE; // White tip
    return C_RUST;
  }

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// 6. PANDA PIXEL GENERATOR (Giant panda with black patches & ears)
// -------------------------------------------------------------
function getPandaPixel(frame, x, y) {
  const C_WHITE_FUR = [248, 250, 252, 255];
  const C_BLACK_FUR = [15, 23, 42, 255];

  if (frame >= 8 && frame <= 11) {
    const z = getSleepZPixel(frame - 8, x, y);
    if (z) return z;
    const dx = x - 16;
    const dy = y - 23;
    if (dx * dx + dy * dy * 1.2 <= 64) {
      if (y >= 19 && y <= 22 && ((x >= 11 && x <= 14) || (x >= 18 && x <= 21))) return C_BLACK_FUR;
      if (y >= 23 && y <= 26 && x >= 14 && x <= 18) return C_WHITE_FUR;
      return C_BLACK_FUR;
    }
    return C_TRANSPARENT;
  }

  const isWalk = frame >= 4 && frame <= 7;
  const isAlert = frame >= 12 && frame <= 15;
  const isHappy = frame >= 16 && frame <= 19;
  const isCurious = frame >= 20 && frame <= 23;

  if (isAlert) { const a = getAlertMarkPixel(frame, x, y); if (a) return a; }
  if (isHappy) { const h = getHappyHeartPixel(frame, x, y); if (h) return h; }
  if (isCurious) { const q = getCuriousQuestionPixel(frame, x, y); if (q) return q; }

  let yBob = isWalk ? ((frame - 4) % 2 === 1 ? -1 : 0) : 0;
  const effY = y - yBob;

  // Round Black Ears (x=10..13, y=7..10 and x=19..22, y=7..10)
  if (effY >= 7 && effY <= 10 && ((x >= 10 && x <= 13) || (x >= 19 && x <= 22))) {
    return C_BLACK_FUR;
  }

  // Round White Head: center (16, 14), radius 6
  const hdx = x - 16;
  const hdy = effY - 14;
  if (hdx * hdx + hdy * hdy <= 36) {
    // Iconic black eye patches: x=12..14, y=12..15 and x=18..20, y=12..15
    const isLeftPatch = x >= 12 && x <= 14 && effY >= 12 && effY <= 15;
    const isRightPatch = x >= 18 && x <= 20 && effY >= 12 && effY <= 15;

    if (isLeftPatch || isRightPatch) {
      if (isAlert) {
        if (effY === 13 && (x === 13 || x === 19)) return C_WHITE_FUR;
        return C_BLACK_FUR;
      } else if (isHappy) {
        if (effY === 13 && (x === 13 || x === 19)) return C_WHITE_FUR;
        return C_BLACK_FUR;
      }
      if (effY === 13 && (x === 13 || x === 19)) return C_WHITE_FUR;
      return C_BLACK_FUR;
    }

    // Black nose & mouth
    if (effY === 16 && x === 16) return C_BLACK_FUR;

    // Happy bamboo stick
    if (isHappy && effY >= 16 && effY <= 18 && x === 14) return [16, 185, 129, 255]; // green bamboo

    return C_WHITE_FUR;
  }

  // Black shoulders & arms, White belly
  if (effY >= 19 && effY <= 28) {
    const bdx = x - 16;
    const bdy = effY - 24;
    if (bdx * bdx * 1.1 + bdy * bdy <= 42) {
      // White belly center
      if (x >= 14 && x <= 18 && effY >= 21 && effY <= 26) return C_WHITE_FUR;
      return C_BLACK_FUR;
    }
  }

  // Black paws
  if (effY === 28 && ((x >= 12 && x <= 14) || (x >= 18 && x <= 20))) return C_BLACK_FUR;

  return C_TRANSPARENT;
}

// -------------------------------------------------------------
// DEFINITION MATRIX
// -------------------------------------------------------------
const ANIMALS = [
  {
    id: 'cat',
    name: 'Pixel Cat',
    pixelFn: getCatPixel,
    anchors: { hat: { x: 11, y: 3 }, glasses: { x: 10, y: 12 }, bow: { x: 15, y: 23 } }
  },
  {
    id: 'dog',
    name: 'Pixel Dog',
    pixelFn: getDogPixel,
    anchors: { hat: { x: 11, y: 4 }, glasses: { x: 10, y: 12 }, bow: { x: 15, y: 22 } }
  },
  {
    id: 'hamster',
    name: 'Pixel Hamster',
    pixelFn: getHamsterPixel,
    anchors: { hat: { x: 11, y: 5 }, glasses: { x: 10, y: 13 }, bow: { x: 15, y: 24 } }
  },
  {
    id: 'rabbit',
    name: 'Pixel Rabbit',
    pixelFn: getRabbitPixel,
    anchors: { hat: { x: 11, y: 2 }, glasses: { x: 10, y: 13 }, bow: { x: 15, y: 23 } }
  },
  {
    id: 'fox',
    name: 'Pixel Fox',
    pixelFn: getFoxPixel,
    anchors: { hat: { x: 11, y: 3 }, glasses: { x: 10, y: 12 }, bow: { x: 15, y: 23 } }
  },
  {
    id: 'panda',
    name: 'Pixel Panda',
    pixelFn: getPandaPixel,
    anchors: { hat: { x: 11, y: 4 }, glasses: { x: 10, y: 13 }, bow: { x: 15, y: 23 } }
  }
];

const TINT_PALETTES = {
  amber: 'hue-rotate(20deg) saturate(1.4)',
  sapphire: 'hue-rotate(180deg) saturate(1.2)',
  emerald: 'hue-rotate(90deg) saturate(1.3)',
  rose: 'hue-rotate(310deg) saturate(1.5)',
  violet: 'hue-rotate(240deg) saturate(1.3)',
  slate: 'grayscale(100%) brightness(0.9)'
};

const overlaySkinsDir = path.resolve(__dirname, '../packages/overlay/skins');
const previewsDir = path.join(overlaySkinsDir, 'previews');

if (!fs.existsSync(previewsDir)) {
  fs.mkdirSync(previewsDir, { recursive: true });
}

console.log('Generating sprite sheets and preview contact sheets...');

for (const animal of ANIMALS) {
  const animalDir = path.join(overlaySkinsDir, animal.id);
  if (!fs.existsSync(animalDir)) {
    fs.mkdirSync(animalDir, { recursive: true });
  }

  // 1. Generate 24-frame sprite sheet: 768x32 px
  const sheetBuf = createPng(768, 32, (x, y) => {
    const frame = Math.floor(x / 32);
    const localX = x % 32;
    return animal.pixelFn(frame, localX, y);
  });

  fs.writeFileSync(path.join(animalDir, 'spritesheet.png'), sheetBuf);

  // 2. Generate skin.json
  const skinJson = {
    name: animal.name,
    author: 'TokenPal Contributors',
    license: 'CC0-1.0',
    frameSize: { width: 32, height: 32 },
    fps: 6,
    spriteSheet: 'spritesheet.png',
    supportsTint: true,
    tintPalettes: TINT_PALETTES,
    accessoryAnchors: animal.anchors,
    animations: {
      idle: { from: 0, to: 3 },
      walk: { from: 4, to: 7 },
      sleep: { from: 8, to: 11 },
      alert: { from: 12, to: 15 },
      happy: { from: 16, to: 19 },
      curious: { from: 20, to: 23 }
    }
  };

  fs.writeFileSync(path.join(animalDir, 'skin.json'), JSON.stringify(skinJson, null, 2) + '\n');

  // 3. Generate enlarged contact-sheet preview PNG:
  // 4 frames per row, 6 rows (Idle, Walk, Sleep, Alert, Happy, Curious)
  // Scale = 4 -> each frame is 128x128. Grid: 4 * 128 = 512 width, 6 * 128 = 768 height.
  const SCALE = 4;
  const previewWidth = 4 * 32 * SCALE; // 512
  const previewHeight = 6 * 32 * SCALE; // 768

  const previewBuf = createPng(previewWidth, previewHeight, (x, y) => {
    const col = Math.floor(x / (32 * SCALE));
    const row = Math.floor(y / (32 * SCALE));
    const frame = row * 4 + col;
    const localX = Math.floor((x % (32 * SCALE)) / SCALE);
    const localY = Math.floor((y % (32 * SCALE)) / SCALE);
    return animal.pixelFn(frame, localX, localY);
  });

  fs.writeFileSync(path.join(previewsDir, `${animal.id}.png`), previewBuf);
  console.log(`✓ Generated ${animal.name} (${animal.id}): spritesheet.png, skin.json, previews/${animal.id}.png`);
}

console.log('All animal skins and preview sheets generated successfully.');
