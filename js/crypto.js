// 解密 scripts/encrypt_data.py 產生的題庫：PBKDF2-SHA256 推導金鑰，AES-GCM 解密。
export class WrongPasswordError extends Error {}

const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

// Web Crypto 只在 HTTPS 或 localhost 下提供
export const cryptoAvailable = () => Boolean(globalThis.crypto?.subtle);

export async function decryptBundle(payload, password) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(payload.salt), iterations: payload.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.ciphertext));
  } catch (err) {
    // 驗證標籤不符：密碼錯誤
    if (err.name === 'OperationError') throw new WrongPasswordError();
    throw err;
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
