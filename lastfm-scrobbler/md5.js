// Minimal MD5 (hex) over the UTF-8 encoding of a string. IINA's JS sandbox has no crypto API.
function md5(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const n = utf8.length;
  const words = [];
  for (let i = 0; i < n; i++) words[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  const len = (((n + 8) >> 6) + 1) * 16;
  for (let i = words.length; i < len; i++) words[i] = 0;
  words[len - 2] = (n * 8) >>> 0;
  words[len - 1] = Math.floor((n * 8) / 4294967296);

  const K = [], S = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const rol = (x, c) => (x << c) | (x >>> (32 - c));

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < len; o += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)      { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D;          g = (3 * i + 5) % 16; }
      else             { F = C ^ (B | ~D);       g = (7 * i) % 16; }
      F = (F + A + K[i] + (words[o + g] | 0)) | 0;
      A = D; D = C; C = B;
      B = (B + rol(F, S[(i >> 4) * 4 + (i % 4)])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const hex = (x) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    return s;
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

module.exports = { md5 };
