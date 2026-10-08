const crypto = require('crypto');

let encKey, sigKey;

function init(secret) {
  encKey = crypto.scryptSync(secret, 'asterisk-gui:enc:v1', 32);
  sigKey = crypto.scryptSync(secret, 'asterisk-gui:sig:v1', 32);
}

function encrypt(text) {
  if (text == null || text === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(blob) {
  if (!blob) return '';
  if (!String(blob).startsWith('enc:v1:')) return String(blob);
  try {
    const [, , iv, tag, ct] = blob.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', sigKey).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const exp = crypto.createHmac('sha256', sigKey).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

module.exports = { init, encrypt, decrypt, sign, verify };
