const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage for tracked options and live data cache
let trackedOptions = [];
let liveDataCache = {
  sensex: 75423,
  volatility: 18.5,
  change: 120,
  changePercent: 0.16,
  marketStatus: 'CLOSED',
  optionsActive: false,
  lastUpdate: new Date(),
  error: null
};

/**
 * POST /api/track
 * Start tracking a new Sensex option
 * Body: { entryPrice, quantity, trailingPercent, optionType, strike }
 */
app.post('/api/track', (req, res) => {
  try {
    const { entryPrice, quantity, trailingPercent, optionType, strike } = req.body;

    if (!entryPrice || !quantity || trailingPercent === undefined || !optionType || !strike) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const option = {
      id: Date.now(),
      entryPrice: parseFloat(entryPrice),
      currentPrice: parseFloat(entryPrice),
      quantity: parseInt(quantity),
      trailingPercent: parseFloat(trailingPercent),
      optionType, // 'CALL' or 'PUT'
      strike: parseFloat(strike),
      highestPrice: parseFloat(entryPrice),
      stoploss: calculateStoploss(parseFloat(entryPrice), parseFloat(trailingPercent), optionType),
      status: 'TRACKING',
      createdAt: new Date(),
      updateLog: []
    };

    trackedOptions.push(option);
    res.status(201).json({ success: true, option });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/options
 * Get all tracked options
 */
app.get('/api/options', (req, res) => {
  res.json(trackedOptions);
});

/**
 * PUT /api/options/:id
 * Update the current price of an option
 * Body: { currentPrice }
 */
app.put('/api/options/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { currentPrice } = req.body;

    if (currentPrice === undefined) {
      return res.status(400).json({ error: 'Missing currentPrice' });
    }

    const option = trackedOptions.find(opt => opt.id === parseInt(id));
    if (!option) {
      return res.status(404).json({ error: 'Option not found' });
    }

    const newPrice = parseFloat(currentPrice);
    const oldHighest = option.highestPrice;
    const oldStoploss = option.stoploss;

    // Update highest price if current price is higher
    if (newPrice > option.highestPrice) {
      option.highestPrice = newPrice;
    }

    option.currentPrice = newPrice;

    // Recalculate stoploss based on highest price
    option.stoploss = calculateStoploss(option.highestPrice, option.trailingPercent, option.optionType);

    // Log the update
    option.updateLog.push({
      timestamp: new Date(),
      previousPrice: oldHighest,
      newPrice: newPrice,
      stoploss: option.stoploss,
      pnl: calculatePnL(option)
    });

    // Check if stoploss is hit
    if (isStoplossHit(option)) {
      option.status = 'STOPLOSS_HIT';
    }

    res.json({ success: true, option });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/options/:id
 * Remove an option from tracking
 */
app.delete('/api/options/:id', (req, res) => {
  try {
    const { id } = req.params;
    const index = trackedOptions.findIndex(opt => opt.id === parseInt(id));

    if (index === -1) {
      return res.status(404).json({ error: 'Option not found' });
    }

    const removedOption = trackedOptions.splice(index, 1)[0];
    res.json({ success: true, message: 'Option removed', option: removedOption });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/options/:id/exit
 * Exit an option at current price
 */
app.post('/api/options/:id/exit', (req, res) => {
  try {
    const { id } = req.params;
    const option = trackedOptions.find(opt => opt.id === parseInt(id));

    if (!option) {
      return res.status(404).json({ error: 'Option not found' });
    }

    option.status = 'EXITED';
    option.exitPrice = option.currentPrice;
    option.exitedAt = new Date();
    option.finalPnL = calculatePnL(option);

    res.json({ success: true, option });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/options/:id
 * Get details of a specific option
 */
app.get('/api/options/:id', (req, res) => {
  try {
    const { id } = req.params;
    const option = trackedOptions.find(opt => opt.id === parseInt(id));

    if (!option) {
      return res.status(404).json({ error: 'Option not found' });
    }

    res.json(option);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper function to calculate stoploss
 */
function calculateStoploss(price, trailingPercent, optionType) {
  if (optionType === 'CALL') {
    // For CALL options, stoploss is below the highest price
    return price * (1 - trailingPercent / 100);
  } else {
    // For PUT options, stoploss is above the highest price
    return price * (1 + trailingPercent / 100);
  }
}

/**
 * Helper function to check if stoploss is hit
 */
function isStoplossHit(option) {
  if (option.optionType === 'CALL') {
    return option.currentPrice <= option.stoploss;
  } else {
    return option.currentPrice >= option.stoploss;
  }
}

/**
 * Helper function to calculate P&L
 */
function calculatePnL(option) {
  const priceChange = option.currentPrice - option.entryPrice;
  const pnl = priceChange * option.quantity;
  const pnlPercent = (priceChange / option.entryPrice) * 100;
  return {
    pnl: pnl.toFixed(2),
    pnlPercent: pnlPercent.toFixed(2)
  };
}

/**
 * Check if market is open (IST timezone - 9:15 AM to 3:30 PM, Monday to Friday)
 */
function isMarketOpen() {
  const now = new Date();
  
  // Convert to IST (UTC+5:30)
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  
  const dayOfWeek = istTime.getDay();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  // Market hours: 9:15 AM (555 minutes) to 3:30 PM (915 minutes)
  const marketOpen = 9 * 60 + 15; // 555
  const marketClose = 15 * 60 + 30; // 930
  
  // Check if it's a weekday (Monday=1 to Friday=5)
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  
  return isWeekday && timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
}

/**
 * Fetch live SENSEX data from multiple sources
 */
async function fetchLiveSensexData() {
  try {
    // Method 1: Try RapidAPI financial data
    try {
      const response = await axios.get('https://real-time-finance-data.p.rapidapi.com/stock-quote', {
        params: { symbol: '%5EBSESN', language: 'en' },
        headers: {
          'X-RapidAPI-Key': process.env.RAPID_API_KEY || 'demo',
          'X-RapidAPI-Host': 'real-time-finance-data.p.rapidapi.com'
        },
        timeout: 5000
      });
      
      if (response.data?.data?.price) {
        const price = parseFloat(response.data.data.price);
        const change = parseFloat(response.data.data.change) || 0;
        const changePercent = parseFloat(response.data.data.change_percent) || 0;
        
        liveDataCache = {
          sensex: Math.round(price),
          volatility: (Math.abs(changePercent) * 2).toFixed(2),
          change: change.toFixed(2),
          changePercent: changePercent.toFixed(2),
          marketStatus: isMarketOpen() ? 'OPEN' : 'CLOSED',
          optionsActive: isMarketOpen(),
          lastUpdate: new Date(),
          source: 'RapidAPI',
          error: null
        };
        console.log('✓ Live SENSEX data fetched from RapidAPI');
        return;
      }
    } catch (e) {
      console.log('RapidAPI fetch failed, trying alternative...');
    }
    
    // Method 2: Try Yahoo Finance API
    try {
      const response = await axios.get('https://query1.finance.yahoo.com/v10/finance/quoteSummary/%5EBSESN', {
        params: { modules: 'price,summaryDetail' },
        timeout: 5000
      });
      
      if (response.data?.quoteSummary?.result?.[0]?.price) {
        const priceData = response.data.quoteSummary.result[0].price;
        const price = priceData.regularMarketPrice?.raw || 75423;
        const change = priceData.regularMarketChange?.raw || 0;
        const changePercent = priceData.regularMarketChangePercent?.raw || 0;
        
        liveDataCache = {
          sensex: Math.round(price),
          volatility: (Math.abs(changePercent) * 2).toFixed(2),
          change: change.toFixed(2),
          changePercent: changePercent.toFixed(2),
          marketStatus: isMarketOpen() ? 'OPEN' : 'CLOSED',
          optionsActive: isMarketOpen(),
          lastUpdate: new Date(),
          source: 'Yahoo Finance',
          error: null
        };
        console.log('✓ Live SENSEX data fetched from Yahoo Finance');
        return;
      }
    } catch (e) {
      console.log('Yahoo Finance fetch failed, trying NSE...');
    }
    
    // Method 3: Fallback with realistic data simulation
    const marketOpen = isMarketOpen();
    const basePrice = 75423;
    const randomChange = (Math.random() - 0.5) * 200; // -100 to +100
    const price = marketOpen ? basePrice + randomChange : basePrice;
    const changePercent = ((randomChange / basePrice) * 100).toFixed(2);
    
    liveDataCache = {
      sensex: Math.round(price),
      volatility: (Math.random() * 25 + 10).toFixed(2),
      change: randomChange.toFixed(2),
      changePercent: changePercent,
      marketStatus: marketOpen ? 'OPEN' : 'CLOSED',
      optionsActive: marketOpen,
      lastUpdate: new Date(),
      source: 'Simulated (APIs unavailable)',
      error: null
    };
    console.log(`✓ Using simulated data (Market: ${liveDataCache.marketStatus})`);
    
  } catch (error) {
    console.error('Error fetching live data:', error.message);
    liveDataCache.error = error.message;
  }
}

// Update live data every 10 seconds
setInterval(() => {
  fetchLiveSensexData();
}, 10000);

// Fetch on startup
fetchLiveSensexData();

/**
 * GET /api/live
 * Get live SENSEX and volatility data
 */
app.get('/api/live', (req, res) => {
  res.json(liveDataCache);
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Sensex Options Tracker running on http://localhost:${PORT}`);
});
