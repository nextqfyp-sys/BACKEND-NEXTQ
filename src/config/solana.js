'use strict';

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const bs58 = require('bs58');
const logger = require('./logger');

// ── Singleton connection + platform keypair ───────────────────────────────

let _connection = null;
let _platformKeypair = null;
let _mintPubkey = null;

function isSolanaConfigured() {
  const key = process.env.SOLANA_WALLET_PRIVATE_KEY || '';
  const mint = process.env.SOLANA_TOKEN_MINT_ADDRESS || '';
  return (
    key.length > 0 &&
    key !== 'your_base58_private_key' &&
    mint.length > 0 &&
    mint !== 'your_token_mint_address'
  );
}

function getConnection() {
  if (!_connection) {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    _connection = new Connection(rpcUrl, 'confirmed');
  }
  return _connection;
}

function getPlatformKeypair() {
  if (!_platformKeypair) {
    const raw = process.env.SOLANA_WALLET_PRIVATE_KEY;
    if (!raw) throw new Error('SOLANA_WALLET_PRIVATE_KEY not set');
    const secretBytes = bs58.decode(raw);
    _platformKeypair = Keypair.fromSecretKey(secretBytes);
  }
  return _platformKeypair;
}

function getMintPubkey() {
  if (!_mintPubkey) {
    _mintPubkey = new PublicKey(process.env.SOLANA_TOKEN_MINT_ADDRESS);
  }
  return _mintPubkey;
}

// COIN has 2 decimals — 1 COIN = 100 raw units
const COIN_DECIMALS = 2;
const RAW_PER_COIN = BigInt(100);

/**
 * Get the on-chain COIN balance for a wallet.
 * Returns 0 (as BigInt) if the ATA doesn't exist.
 * @param {string} walletAddress - base58
 * @returns {Promise<BigInt>} balance in whole COIN
 */
async function getOnChainCoinBalance(walletAddress) {
  try {
    const conn = getConnection();
    const walletPubkey = new PublicKey(walletAddress);
    const ata = getAssociatedTokenAddressSync(getMintPubkey(), walletPubkey);
    const info = await conn.getTokenAccountBalance(ata);
    const raw = BigInt(info.value.amount);
    return raw / RAW_PER_COIN;
  } catch {
    return BigInt(0);
  }
}

/**
 * Get the latest blockhash from Solana RPC.
 * @returns {Promise<string>}
 */
async function getLatestBlockhash() {
  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  return blockhash;
}

/**
 * Mint COIN to a user's wallet (platform is mint authority).
 * Creates the ATA if it doesn't exist.
 * @param {string} walletAddress - recipient base58 address
 * @param {BigInt} rawAmount - in raw units (1 COIN = 100)
 * @returns {Promise<string>} transaction signature
 */
async function mintTokensToUser(walletAddress, rawAmount) {
  const conn = getConnection();
  const payer = getPlatformKeypair();
  const mint = getMintPubkey();
  const recipientPubkey = new PublicKey(walletAddress);
  const ata = getAssociatedTokenAddressSync(mint, recipientPubkey);

  const instructions = [];

  // Create ATA if missing
  const ataInfo = await conn.getAccountInfo(ata);
  if (!ataInfo) {
    logger.info(`Solana: creating ATA for ${walletAddress}`);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        recipientPubkey,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // Mint instruction
  instructions.push(
    createMintToInstruction(mint, ata, payer.publicKey, rawAmount)
  );

  const tx = new Transaction().add(...instructions);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  logger.info(`Solana: minted ${rawAmount} raw units to ${walletAddress} — tx: ${sig}`);
  return sig;
}

/**
 * Ensure the recipient's ATA exists. If not, create it (platform pays rent).
 * Returns the ATA address and whether it was just created.
 * @param {string} recipientWallet - base58
 * @returns {Promise<{ ata: string, created: boolean, blockhash: string }>}
 */
async function ensureRecipientAta(recipientWallet) {
  const conn = getConnection();
  const payer = getPlatformKeypair();
  const mint = getMintPubkey();
  const recipientPubkey = new PublicKey(recipientWallet);
  const ata = getAssociatedTokenAddressSync(mint, recipientPubkey);

  const ataInfo = await conn.getAccountInfo(ata);
  let created = false;

  if (!ataInfo) {
    logger.info(`Solana: creating ATA ${ata.toBase58()} for ${recipientWallet}`);
    const createIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      recipientPubkey,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new Transaction().add(createIx);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    created = true;
    logger.info(`Solana: ATA created tx: ${sig}`);
  }

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  return { ata: ata.toBase58(), created, blockhash };
}

/**
 * Submit a pre-signed transaction (from Phantom) to the Solana RPC.
 * @param {Buffer|Uint8Array} txBytes - serialized signed transaction
 * @returns {Promise<string>} transaction signature
 */
async function sendSignedTransaction(txBytes) {
  const conn = getConnection();
  const sig = await conn.sendRawTransaction(txBytes, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

module.exports = {
  isSolanaConfigured,
  getConnection,
  getPlatformKeypair,
  getMintPubkey,
  getOnChainCoinBalance,
  getLatestBlockhash,
  mintTokensToUser,
  ensureRecipientAta,
  sendSignedTransaction,
  COIN_DECIMALS,
  RAW_PER_COIN,
};
