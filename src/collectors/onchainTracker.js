const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db/database');
const config = require('../utils/config');

// Etherscan V2 multi-chain — one API key covers 60+ EVM chains
// Free tier: Ethereum (1), Polygon (137), Arbitrum (42161)
// BSC (56), Base (8453), Optimism (10) need paid or separate BSCScan key
const CHAIN_CONFIG = {
  ethereum: { id: 1, explorer: 'etherscan.io', name: 'Ethereum' },
  eth: { id: 1, explorer: 'etherscan.io', name: 'Ethereum' },
  bsc: { id: 56, explorer: 'bscscan.com', name: 'BSC' },
  bnb: { id: 56, explorer: 'bscscan.com', name: 'BSC' },
  polygon: { id: 137, explorer: 'polygonscan.com', name: 'Polygon' },
  arbitrum: { id: 42161, explorer: 'arbiscan.io', name: 'Arbitrum' },
  base: { id: 8453, explorer: 'basescan.org', name: 'Base' },
  optimism: { id: 10, explorer: 'optimistic.etherscan.io', name: 'Optimism' },
  avalanche: { id: 43114, explorer: 'snowscan.xyz', name: 'Avalanche' },
};

class OnchainTracker {
  constructor() {
    this.callbacks = [];
    this.knownTxHashes = new Set();
  }

  onWhaleAlert(callback) {
    this.callbacks.push(callback);
  }

  // Unified EVM whale check via Etherscan V2 API (one key, any chain)
  async checkEvmWhales(tokenAddress, symbol, chainName = 'ethereum') {
    const chain = CHAIN_CONFIG[chainName.toLowerCase()];
    if (!chain) return [];

    // BSC: try V2 first, fall back to bscscan.com with separate key
    const isBsc = chain.id === 56;
    const apiKey = config.onchain.etherscanKey;
    if (!apiKey && !(isBsc && config.onchain.bscscanKey)) return [];

    const alerts = [];
    let txData;

    try {
      // Try Etherscan V2 unified endpoint first
      if (apiKey) {
        const { data } = await axios.get('https://api.etherscan.io/v2/api', {
          params: {
            chainid: chain.id,
            module: 'account',
            action: 'tokentx',
            contractaddress: tokenAddress,
            page: 1,
            offset: 20,
            sort: 'desc',
            apikey: apiKey,
          },
          timeout: 10000,
        });
        if (data.status === '1' && Array.isArray(data.result)) {
          txData = data.result;
        } else if (isBsc && data.result?.includes?.('not supported')) {
          // BSC not on free tier — fall back to bscscan.com
          txData = null;
        }
      }

      // BSC fallback: use bscscan.com directly if V2 failed
      if (!txData && isBsc && config.onchain.bscscanKey) {
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
        if (data.status === '1' && Array.isArray(data.result)) txData = data.result;
      }

      if (!txData || !txData.length) return alerts;

      for (const tx of txData) {
        if (this.knownTxHashes.has(tx.hash)) continue;
        this.knownTxHashes.add(tx.hash);

        const decimals = parseInt(tx.tokenDecimal) || 18;
        const amount = parseFloat(tx.value) / Math.pow(10, decimals);

        const alert = {
          chain: chain.name.toLowerCase(),
          txHash: tx.hash,
          symbol,
          amount,
          usdValue: `~$${amount.toLocaleString()}`,
          from: tx.from,
          to: tx.to,
          txUrl: `https://${chain.explorer}/tx/${tx.hash}`,
          type: this.classifyTransfer(tx.from, tx.to),
          interpretation: '',
        };

        alert.interpretation = this.interpretTransfer(alert);
        alerts.push(alert);

        await db.saveWhaleTx(alert);
        for (const cb of this.callbacks) {
          try { await cb(alert); } catch (e) { logger.error(`Whale callback error: ${e.message}`); }
        }
      }
    } catch (err) {
      logger.error(`EVM whale check failed (${chain.name}): ${err.message}`);
    }

    return alerts;
  }

  // Backward-compatible aliases
  async checkEthWhales(tokenAddress, symbol) {
    return this.checkEvmWhales(tokenAddress, symbol, 'ethereum');
  }
  async checkBscWhales(tokenAddress, symbol) {
    return this.checkEvmWhales(tokenAddress, symbol, 'bsc');
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

  static EXCHANGE_ADDRESSES = new Set([
    // Binance
    '0x28c6c06298d514db089934071355e5743bf21d60',
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
    '0xf977814e90da44bfa03b6295a0616a897441acec',
    '0x5a52e96bacdabb82fd05763e25335261b270efcb',
    '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
    '0x3c783c21a0383057d128bae431894a5c19f9cf06',
    '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
    // OKX
    '0x5041ed759dd4afc3a72b8192c143f72f4724081a',
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
    '0x98ec059dc3adfbdd63429227d09cb8473b089906',
    // MEXC
    '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88',
    '0x3cc936b795a188f0e246cbb2d74c5bd190aecf18',
    // Bybit
    '0x1ab87cd2a58efc7aa98a6700f2a495a3c0b7af18',
    '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
    // Gate.io
    '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
    '0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c',
    // KuCoin
    '0xd6216fc19db775df9774a6e33526131da7d19a2c',
    '0xf16e9b0d03470827a95cdfd0cb8a8a3b46969b91',
    // Coinbase
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
    '0x503828976d22510aad0201ac7ec88293211d23da',
    '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
    // Kraken
    '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
    '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0',
    // Bitget
    '0x97b9d2e1a5ec63395c4b0b1b5da6fdb999686203',
    // Crypto.com
    '0x6262998ced04146fa42253a5c0af90ca02dfd2a3',
    '0x46340b20830761efd32832a74d7169b29feb9758',
    // HTX (Huobi)
    '0xab5c66752a9e8167967685f1450532fb96d5d24f',
    '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b',
    '0x18709e89bd403f470088abdacebe86cc60dda12e',
    // Bitfinex
    '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f',
    '0x742d35cc6634c0532925a3b844bc9e7595f2bd3e',
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

  // ═══════════════════════════════════════════════
  // ARKHAM INTELLIGENCE API — Exchange flow & entity tracking
  // ═══════════════════════════════════════════════

  async arkhamRequest(endpoint, params = {}) {
    if (!config.onchain.arkhamKey) return null;
    try {
      const { data } = await axios.get(`https://api.arkm.com${endpoint}`, {
        params,
        headers: { 'API-Key': config.onchain.arkhamKey },
        timeout: 15000,
      });
      return data;
    } catch (err) {
      if (err.response?.status === 429) {
        logger.debug('Arkham rate limited');
      } else {
        logger.debug(`Arkham API error: ${err.message}`);
      }
      return null;
    }
  }

  // Get token transfers — detects exchange outflows like Flams' BULLA call
  async checkArkhamTokenTransfers(symbol, tokenAddress, chain = 'ethereum') {
    if (!config.onchain.arkhamKey) return [];

    const data = await this.arkhamRequest('/transfers', {
      base: tokenAddress,
      chain,
      limit: 30,
      sortKey: 'time',
      sortDir: 'desc',
    });

    if (!data?.transfers) return [];

    const alerts = [];
    let exchangeOutflowTotal = 0;
    let exchangeInflowTotal = 0;
    let largeTransfers = 0;

    for (const tx of data.transfers) {
      const usdValue = tx.unitPrice ? tx.tokenQuantity * tx.unitPrice : 0;
      const fromEntity = tx.fromAddress?.arkhamEntity?.name || '';
      const toEntity = tx.toAddress?.arkhamEntity?.name || '';

      // Arkham labels entities — detect exchange flows directly
      const fromIsExchange = this.isExchangeEntity(fromEntity);
      const toIsExchange = this.isExchangeEntity(toEntity);

      if (fromIsExchange && !toIsExchange && usdValue > 10000) {
        exchangeOutflowTotal += usdValue;
        largeTransfers++;
      } else if (!fromIsExchange && toIsExchange && usdValue > 10000) {
        exchangeInflowTotal += usdValue;
      }
    }

    // Generate flow summary alert
    if (exchangeOutflowTotal > 50000 || exchangeInflowTotal > 50000) {
      const netFlow = exchangeOutflowTotal - exchangeInflowTotal;
      const alert = {
        type: 'arkham_flow',
        symbol: symbol.toUpperCase(),
        chain,
        exchangeOutflow: exchangeOutflowTotal,
        exchangeInflow: exchangeInflowTotal,
        netFlow,
        largeTransfers,
        bias: netFlow > 0 ? 'bullish' : 'bearish',
        interpretation: this.interpretFlow(netFlow, exchangeOutflowTotal, exchangeInflowTotal, symbol),
      };
      alerts.push(alert);

      for (const cb of this.callbacks) {
        try { await cb(alert); } catch (e) { logger.error(`Arkham callback error: ${e.message}`); }
      }
    }

    return alerts;
  }

  // Check entity holdings for a token — see which big players hold it
  async checkArkhamEntityHoldings(entityName) {
    const data = await this.arkhamRequest(`/portfolio/entity/${encodeURIComponent(entityName)}`);
    if (!data) return null;
    return data;
  }

  // Scan multiple tokens for exchange flow activity
  async scanExchangeFlows(tokenList) {
    if (!config.onchain.arkhamKey) {
      logger.debug('Arkham API key not set — skipping exchange flow scan');
      return [];
    }

    const results = [];
    for (const token of tokenList) {
      try {
        const alerts = await this.checkArkhamTokenTransfers(
          token.symbol,
          token.contractAddress,
          token.chain || 'ethereum'
        );
        results.push(...alerts);
        // Rate limit: 1 req/sec for /transfers
        await new Promise(r => setTimeout(r, 1100));
      } catch (e) {
        logger.debug(`Arkham flow check failed for ${token.symbol}: ${e.message}`);
      }
    }
    return results;
  }

  isExchangeEntity(name) {
    if (!name) return false;
    const n = name.toLowerCase();
    return ['binance', 'mexc', 'bybit', 'okx', 'gate.io', 'kucoin', 'huobi', 'htx', 'bitget', 'coinbase', 'kraken', 'bitfinex', 'gemini', 'crypto.com']
      .some(ex => n.includes(ex));
  }

  interpretFlow(netFlow, outflow, inflow, symbol) {
    const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
    if (netFlow > 100000) {
      return `🟢 <b>NET OUTFLOW</b> ${fmt(netFlow)} of $${symbol} leaving exchanges\n` +
        `   Outflow: ${fmt(outflow)} | Inflow: ${fmt(inflow)}\n` +
        `   <i>Tokens leaving exchanges = accumulation. Holders moving to cold storage, reducing sell pressure. Bullish signal — similar to BULLA before its 1000%+ move.</i>`;
    } else if (netFlow < -100000) {
      return `🔴 <b>NET INFLOW</b> ${fmt(Math.abs(netFlow))} of $${symbol} flowing into exchanges\n` +
        `   Outflow: ${fmt(outflow)} | Inflow: ${fmt(inflow)}\n` +
        `   <i>Tokens entering exchanges = potential sell pressure. Holders may be preparing to dump. Bearish signal — exercise caution on longs.</i>`;
    }
    return `🔄 Balanced flow — Outflow: ${fmt(outflow)} | Inflow: ${fmt(inflow)}`;
  }

  formatArkhamAlert(alert) {
    if (alert.type !== 'arkham_flow') return null;
    let msg = '🔗 <b>EXCHANGE FLOW ALERT</b>\n\n';
    msg += `<b>$${alert.symbol}</b> on ${alert.chain}\n`;
    msg += alert.interpretation + '\n\n';
    msg += `Large transfers: ${alert.largeTransfers}\n`;
    msg += `<i>Data: Arkham Intelligence</i>`;
    return msg;
  }
}

module.exports = OnchainTracker;
