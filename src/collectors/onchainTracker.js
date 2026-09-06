const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db/database');
const config = require('../utils/config');

// Etherscan V2 multi-chain — one API key covers 60+ EVM chains
// Free tier: Ethereum (1), Polygon (137), Arbitrum (42161)
// BSC (56), Base (8453), Optimism (10) need paid or separate BSCScan key
// Robinhood Chain uses Blockscout API (separate free key from dev.blockscout.com)
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
  robinhood: { id: 4663, explorer: 'robinhoodchain.blockscout.com', name: 'Robinhood', blockscout: true },
  rhood: { id: 4663, explorer: 'robinhoodchain.blockscout.com', name: 'Robinhood', blockscout: true },
};

class OnchainTracker {
  constructor() {
    this.callbacks = [];
    this.knownTxHashes = new Set();
    this.contractCache = new Map(); // symbol → { address, chain, timestamp }
    this.flowCache = new Map(); // symbol → { timestamp, data }
  }

  onWhaleAlert(callback) {
    this.callbacks.push(callback);
  }

  // Shared method: fetch recent token transfers using best available source
  async fetchTokenTransfers(tokenAddress, chain, limit = 20) {
    const isBsc = chain.id === 56;
    const isBlockscout = chain.blockscout === true;
    const apiKey = config.onchain.etherscanKey;
    let txData = null;

    // 1. Blockscout chains (Robinhood etc)
    if (isBlockscout) {
      const blockscoutKey = config.onchain.blockscoutKey || '';
      const { data } = await axios.get(`https://${chain.explorer}/api`, {
        params: {
          module: 'account', action: 'tokentx', contractaddress: tokenAddress,
          page: 1, offset: limit, sort: 'desc',
          ...(blockscoutKey ? { apikey: blockscoutKey } : {}),
        },
        timeout: 10000,
      });
      if (data.status === '1' && Array.isArray(data.result)) return data.result;
    }

    // 2. Etherscan V2 unified endpoint
    if (apiKey && !isBlockscout) {
      const { data } = await axios.get('https://api.etherscan.io/v2/api', {
        params: {
          chainid: chain.id, module: 'account', action: 'tokentx',
          contractaddress: tokenAddress, page: 1, offset: limit, sort: 'desc', apikey: apiKey,
        },
        timeout: 10000,
      });
      if (data.status === '1' && Array.isArray(data.result)) {
        txData = data.result;
      } else if (isBsc && data.result?.includes?.('not supported')) {
        txData = null;
      }
    }

    // 3. BSCScan direct API fallback
    if (!txData && isBsc && config.onchain.bscscanKey) {
      const { data } = await axios.get('https://api.bscscan.com/api', {
        params: {
          module: 'account', action: 'tokentx', contractaddress: tokenAddress,
          page: 1, offset: limit, sort: 'desc', apikey: config.onchain.bscscanKey,
        },
        timeout: 10000,
      });
      if (data.status === '1' && Array.isArray(data.result)) txData = data.result;
    }

    // 4. BSC RPC fallback — no API key needed, query Transfer events directly
    if (!txData && isBsc) {
      txData = await this.fetchBscRpcTransfers(tokenAddress, limit);
    }

    return txData;
  }

  // BSC RPC: query ERC-20 Transfer events directly from the blockchain (free, no key)
  async fetchBscRpcTransfers(tokenAddress, limit = 20) {
    const BSC_RPCS = [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed.bnbchain.org',
      'https://bsc-dataseed1.defibit.io',
    ];

    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const rpc of BSC_RPCS) {
      try {
        const { data: blockData } = await axios.post(rpc, {
          jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [],
        }, { timeout: 8000 });
        const latestBlock = parseInt(blockData.result, 16);
        // Scan last 500 blocks (~25 min on BSC at 3s/block) — public RPCs limit range
        const fromBlock = '0x' + Math.max(latestBlock - 500, 0).toString(16);

        const { data: logData } = await axios.post(rpc, {
          jsonrpc: '2.0', id: 2, method: 'eth_getLogs',
          params: [{
            address: tokenAddress,
            fromBlock,
            toBlock: 'latest',
            topics: [TRANSFER_TOPIC],
          }],
        }, { timeout: 15000 });

        if (!logData.result || !Array.isArray(logData.result)) continue;

        // Parse Transfer logs into Etherscan-compatible format
        const logs = logData.result.slice(-limit).reverse();
        return logs.map(log => ({
          hash: log.transactionHash,
          from: '0x' + (log.topics[1] || '').slice(26),
          to: '0x' + (log.topics[2] || '').slice(26),
          value: BigInt(log.data || '0x0').toString(),
          tokenDecimal: '18',
          blockNumber: parseInt(log.blockNumber, 16).toString(),
        }));
      } catch (err) {
        logger.debug(`BSC RPC ${rpc} failed: ${err.message}`);
      }
    }
    return null;
  }

  // Unified EVM whale check via Etherscan V2 API (one key, any chain)
  async checkEvmWhales(tokenAddress, symbol, chainName = 'ethereum') {
    const chain = CHAIN_CONFIG[chainName.toLowerCase()];
    if (!chain) return [];

    const isBsc = chain.id === 56;
    const isBlockscout = chain.blockscout === true;
    const apiKey = config.onchain.etherscanKey;

    const alerts = [];
    let txData;

    try {
      txData = await this.fetchTokenTransfers(tokenAddress, chain, 20);

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
    // Binance (hot wallets + proxies + DEX router)
    '0x28c6c06298d514db089934071355e5743bf21d60',
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
    '0xf977814e90da44bfa03b6295a0616a897441acec',
    '0x5a52e96bacdabb82fd05763e25335261b270efcb',
    '0x56eddb7aa87536c09ccc2793473599fd21a8b17f',
    '0x3c783c21a0383057d128bae431894a5c19f9cf06',
    '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
    '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be',
    '0x9696f59e4d72e237be84ffd425dcad154bf96976',
    // OKX
    '0x5041ed759dd4afc3a72b8192c143f72f4724081a',
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
    '0x98ec059dc3adfbdd63429227d09cb8473b089906',
    // MEXC (hot wallets + deposit addresses from Etherscan labels)
    '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88',
    '0x3cc936b795a188f0e246cbb2d74c5bd190aecf18',
    '0x0211f3cedbef3143223d3acf0e589747933e8527',
    '0x9642b23ed1e01df1092b92641051881a322f5d4e',
    '0x469afe803c54a36674c55231489cf4b61da8c1bc',
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
  // AUTOMATED EXCHANGE FLOW DETECTION via Etherscan
  // ═══════════════════════════════════════════════

  async resolveContractAddress(symbol) {
    const key = symbol.toUpperCase();
    const cached = this.contractCache.get(key);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached;

    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/search', {
        params: { query: symbol },
        timeout: 10000,
      });

      const coin = data?.coins?.find(c =>
        c.symbol?.toUpperCase() === key ||
        c.id?.toUpperCase() === key
      );
      if (!coin?.id) return null;

      await new Promise(r => setTimeout(r, 1200));

      const { data: detail } = await axios.get(`https://api.coingecko.com/api/v3/coins/${coin.id}`, {
        params: { localization: false, tickers: false, market_data: false, community_data: false, developer_data: false },
        timeout: 10000,
      });

      const platforms = detail?.platforms || {};
      let address = null;
      let chain = null;

      // Prefer Ethereum, then BSC, then others
      if (platforms['ethereum']) { address = platforms['ethereum']; chain = 'ethereum'; }
      else if (platforms['binance-smart-chain']) { address = platforms['binance-smart-chain']; chain = 'bsc'; }
      else if (platforms['polygon-pos']) { address = platforms['polygon-pos']; chain = 'polygon'; }
      else if (platforms['arbitrum-one']) { address = platforms['arbitrum-one']; chain = 'arbitrum'; }
      else if (platforms['base']) { address = platforms['base']; chain = 'base'; }
      else {
        const first = Object.entries(platforms).find(([, v]) => v && v.startsWith('0x'));
        if (first) { address = first[1]; chain = first[0]; }
      }

      if (!address) return null;

      const result = { address, chain, symbol: key, name: detail.name, timestamp: Date.now() };
      this.contractCache.set(key, result);
      logger.debug(`Resolved ${key} → ${chain}:${address.slice(0, 10)}...`);
      return result;
    } catch (err) {
      if (err.response?.status === 429) {
        logger.debug('CoinGecko rate limited — skipping contract resolve');
      } else {
        logger.debug(`Contract resolve failed for ${symbol}: ${err.message}`);
      }
      return null;
    }
  }

  async analyzeExchangeFlows(tokenAddress, symbol, chainName = 'ethereum') {
    const chain = CHAIN_CONFIG[chainName.toLowerCase()];
    if (!chain) return null;

    // Check flow cache (5 min TTL)
    const cacheKey = `${symbol}_${chainName}`;
    const cached = this.flowCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) return cached.data;

    let txData = null;

    try {
      txData = await this.fetchTokenTransfers(tokenAddress, chain, 50);

      if (!txData || !txData.length) return null;

      let outflowCount = 0;
      let inflowCount = 0;
      let outflowAmount = 0;
      let inflowAmount = 0;
      const exchangeNames = new Set();

      for (const tx of txData) {
        const decimals = parseInt(tx.tokenDecimal) || 18;
        const amount = parseFloat(tx.value) / Math.pow(10, decimals);
        const fromLower = tx.from.toLowerCase();
        const toLower = tx.to.toLowerCase();
        const fromExchange = OnchainTracker.EXCHANGE_ADDRESSES.has(fromLower);
        const toExchange = OnchainTracker.EXCHANGE_ADDRESSES.has(toLower);

        if (fromExchange && !toExchange) {
          outflowCount++;
          outflowAmount += amount;
          exchangeNames.add(this.identifyExchange(fromLower));
        } else if (!fromExchange && toExchange) {
          inflowCount++;
          inflowAmount += amount;
          exchangeNames.add(this.identifyExchange(toLower));
        }
      }

      const netFlow = outflowAmount - inflowAmount;
      const totalTxs = txData.length;

      const result = {
        symbol,
        chain: chainName,
        outflowCount,
        inflowCount,
        outflowAmount,
        inflowAmount,
        netFlow,
        totalTxs,
        exchanges: [...exchangeNames].filter(Boolean),
        bias: netFlow > 0 ? 'bullish' : netFlow < 0 ? 'bearish' : 'neutral',
        timestamp: Date.now(),
      };

      this.flowCache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;
    } catch (err) {
      logger.error(`Exchange flow analysis failed for ${symbol}: ${err.message}`);
      return null;
    }
  }

  identifyExchange(address) {
    const addr = address.toLowerCase();
    const map = {
      '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
      '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
      '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
      '0x5a52e96bacdabb82fd05763e25335261b270efcb': 'Binance',
      '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': 'Binance',
      '0x3c783c21a0383057d128bae431894a5c19f9cf06': 'Binance',
      '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': 'Binance',
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be': 'Binance',
      '0x9696f59e4d72e237be84ffd425dcad154bf96976': 'Binance',
      '0x5041ed759dd4afc3a72b8192c143f72f4724081a': 'OKX',
      '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
      '0x98ec059dc3adfbdd63429227d09cb8473b089906': 'OKX',
      '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88': 'MEXC',
      '0x3cc936b795a188f0e246cbb2d74c5bd190aecf18': 'MEXC',
      '0x0211f3cedbef3143223d3acf0e589747933e8527': 'MEXC',
      '0x9642b23ed1e01df1092b92641051881a322f5d4e': 'MEXC',
      '0x469afe803c54a36674c55231489cf4b61da8c1bc': 'MEXC',
      '0x1ab87cd2a58efc7aa98a6700f2a495a3c0b7af18': 'Bybit',
      '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
      '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate',
      '0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c': 'Gate',
      '0xd6216fc19db775df9774a6e33526131da7d19a2c': 'KuCoin',
      '0xf16e9b0d03470827a95cdfd0cb8a8a3b46969b91': 'KuCoin',
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase',
      '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase',
      '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase',
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': 'Kraken',
      '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': 'Kraken',
      '0x97b9d2e1a5ec63395c4b0b1b5da6fdb999686203': 'Bitget',
      '0x6262998ced04146fa42253a5c0af90ca02dfd2a3': 'Crypto.com',
      '0x46340b20830761efd32832a74d7169b29feb9758': 'Crypto.com',
      '0xab5c66752a9e8167967685f1450532fb96d5d24f': 'HTX',
      '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b': 'HTX',
      '0x18709e89bd403f470088abdacebe86cc60dda12e': 'HTX',
      '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f': 'Bitfinex',
      '0x742d35cc6634c0532925a3b844bc9e7595f2bd3e': 'Bitfinex',
    };
    return map[addr] || null;
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
