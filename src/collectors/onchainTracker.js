const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db/database');
const config = require('../utils/config');

class OnchainTracker {
  constructor() {
    this.callbacks = [];
    this.knownTxHashes = new Set();
  }

  onWhaleAlert(callback) {
    this.callbacks.push(callback);
  }

  async checkEthWhales(tokenAddress, symbol, minUsdValue = 50000) {
    if (!config.onchain.etherscanKey) return [];
    const alerts = [];

    try {
      const { data } = await axios.get('https://api.etherscan.io/api', {
        params: {
          module: 'account',
          action: 'tokentx',
          contractaddress: tokenAddress,
          page: 1,
          offset: 20,
          sort: 'desc',
          apikey: config.onchain.etherscanKey,
        },
        timeout: 10000,
      });

      if (data.status !== '1' || !data.result) return alerts;

      for (const tx of data.result) {
        if (this.knownTxHashes.has(tx.hash)) continue;
        this.knownTxHashes.add(tx.hash);

        const decimals = parseInt(tx.tokenDecimal) || 18;
        const amount = parseFloat(tx.value) / Math.pow(10, decimals);

        // Rough USD estimate — you'd want a price feed for accuracy
        const alert = {
          chain: 'ethereum',
          txHash: tx.hash,
          symbol,
          amount,
          usdValue: `~$${(amount).toLocaleString()}`, // placeholder
          from: tx.from,
          to: tx.to,
          txUrl: `https://etherscan.io/tx/${tx.hash}`,
          type: this.classifyTransfer(tx.from, tx.to),
          interpretation: '',
        };

        // Detect exchange deposits/withdrawals
        alert.interpretation = this.interpretTransfer(alert);
        alerts.push(alert);

        await db.saveWhaleTx(alert);
        for (const cb of this.callbacks) {
          try { await cb(alert); } catch (e) { logger.error(`Whale callback error: ${e.message}`); }
        }
      }
    } catch (err) {
      logger.error(`Etherscan whale check failed: ${err.message}`);
    }

    return alerts;
  }

  async checkBscWhales(tokenAddress, symbol) {
    if (!config.onchain.bscscanKey) return [];

    try {
      const { data } = await axios.get('https://api.bscscan.com/api', {
        params: {
          module: 'account',
          action: 'tokentx',
          contractaddress: tokenAddress,
          page: 1,
          offset: 20,
          sort: 'desc',
          apikey: config.onchain.bscscanKey,
        },
        timeout: 10000,
      });

      if (data.status !== '1' || !data.result) return [];

      const alerts = [];
      for (const tx of data.result) {
        if (this.knownTxHashes.has(tx.hash)) continue;
        this.knownTxHashes.add(tx.hash);

        const decimals = parseInt(tx.tokenDecimal) || 18;
        const amount = parseFloat(tx.value) / Math.pow(10, decimals);

        const alert = {
          chain: 'bsc',
          txHash: tx.hash,
          symbol,
          amount,
          usdValue: `~$${amount.toLocaleString()}`,
          from: tx.from,
          to: tx.to,
          txUrl: `https://bscscan.com/tx/${tx.hash}`,
          type: this.classifyTransfer(tx.from, tx.to),
        };
        alert.interpretation = this.interpretTransfer(alert);
        alerts.push(alert);
        await db.saveWhaleTx(alert);
      }
      return alerts;
    } catch (err) {
      logger.error(`BscScan whale check failed: ${err.message}`);
      return [];
    }
  }

  async checkSolanaWhales(tokenMint, symbol) {
    if (!config.onchain.solscanKey) return [];

    try {
      const { data } = await axios.get(`https://pro-api.solscan.io/v2.0/token/transfer`, {
        params: { address: tokenMint, page: 1, page_size: 20, sort_by: 'block_time', sort_order: 'desc' },
        headers: { token: config.onchain.solscanKey },
        timeout: 10000,
      });

      if (!data?.data) return [];
      const alerts = [];

      for (const tx of data.data) {
        if (this.knownTxHashes.has(tx.trans_id)) continue;
        this.knownTxHashes.add(tx.trans_id);

        const alert = {
          chain: 'solana',
          txHash: tx.trans_id,
          symbol,
          amount: tx.amount || 0,
          usdValue: `~$${(tx.amount || 0).toLocaleString()}`,
          from: tx.from_address,
          to: tx.to_address,
          txUrl: `https://solscan.io/tx/${tx.trans_id}`,
          type: 'transfer',
        };
        alert.interpretation = this.interpretTransfer(alert);
        alerts.push(alert);
        await db.saveWhaleTx(alert);
      }
      return alerts;
    } catch (err) {
      logger.error(`Solscan whale check failed: ${err.message}`);
      return [];
    }
  }

  // Known exchange hot wallets (subset — expand as needed)
  static EXCHANGE_ADDRESSES = new Set([
    '0x28c6c06298d514db089934071355e5743bf21d60', // Binance 14
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 7
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance 8
    '0x5041ed759dd4afc3a72b8192c143f72f4724081a', // OKX
    '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88', // MEXC
    '0x0d0707963952f2fba59dd06f2b425ace40b492fe', // Gate.io
    '0x1ab87cd2a58efc7aa98a6700f2a495a3c0b7af18', // Bybit
  ].map(a => a.toLowerCase()));

  classifyTransfer(from, to) {
    const fromExchange = OnchainTracker.EXCHANGE_ADDRESSES.has(from.toLowerCase());
    const toExchange = OnchainTracker.EXCHANGE_ADDRESSES.has(to.toLowerCase());
    if (fromExchange && !toExchange) return 'transfer_out'; // withdrawal from exchange = bullish
    if (!fromExchange && toExchange) return 'transfer_in'; // deposit to exchange = potentially bearish
    return 'transfer';
  }

  interpretTransfer(alert) {
    if (alert.type === 'transfer_out') return '🟢 Withdrawn from exchange — possible accumulation / cold storage';
    if (alert.type === 'transfer_in') return '🔴 Deposited to exchange — possible sell pressure incoming';
    return '🔄 Wallet-to-wallet transfer';
  }
}

module.exports = OnchainTracker;
