'use strict';

const nacl = require('tweetnacl');
const bs58 = require('bs58');

/**
 * Phantom prepends this prefix before signing any message.
 * Format: b"\x19Solana Signed Message:\n" + varint(len) + message_bytes
 */
const SOLANA_PREFIX = Buffer.from('\x19Solana Signed Message:\n', 'utf8');

/**
 * Encode a number as a compact varint (Borsh/Solana style).
 * Used for the message-length field in the Phantom prefix.
 */
function encodeVarint(n) {
  const bytes = [];
  let value = n;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

/**
 * Build the exact bytes that Phantom signs when you call
 * provider.signMessage(messageBytes, 'utf8').
 */
function buildPhantomSignedBytes(messageStr) {
  const msgBytes = Buffer.from(messageStr, 'utf8');
  const lenVarint = encodeVarint(msgBytes.length);
  return Buffer.concat([SOLANA_PREFIX, lenVarint, msgBytes]);
}

/**
 * Verify a Phantom wallet signature.
 *
 * @param {string} walletAddress  - base58 public key (32 bytes)
 * @param {string} signedMessage  - the original plaintext message
 * @param {string} signatureBase58 - base58-encoded ed25519 signature (64 bytes)
 * @returns {boolean}
 */
function verifyPhantomSignature(walletAddress, signedMessage, signatureBase58) {
  try {
    const pubkeyBytes = bs58.decode(walletAddress);
    if (pubkeyBytes.length !== 32) return false;

    const sigBytes = bs58.decode(signatureBase58);
    if (sigBytes.length !== 64) return false;

    // Attempt 1: Phantom-prefixed message (normal case)
    const prefixedBytes = buildPhantomSignedBytes(signedMessage);
    if (nacl.sign.detached.verify(prefixedBytes, sigBytes, pubkeyBytes)) {
      return true;
    }

    // Attempt 2: raw message bytes (fallback for testing / alternative wallets)
    const rawBytes = Buffer.from(signedMessage, 'utf8');
    return nacl.sign.detached.verify(rawBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

module.exports = { verifyPhantomSignature };
