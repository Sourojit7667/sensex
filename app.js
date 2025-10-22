// ============================================================
// PURE FRONTEND APPLICATION - Using localStorage for persistence
// ============================================================

// Configuration
const STORAGE_KEY = 'sensex_tracker_data';
let currentOptionId = null;
let refreshInterval = null;
let isRefreshing = false;

// Mobile detection
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// DOM Elements
const addOptionForm = document.getElementById('addOptionForm');
const optionsContainer = document.getElementById('optionsContainer');
const priceModal = document.getElementById('priceModal');
const priceForm = document.getElementById('priceForm');
const closeBtn = document.querySelector('.close');

/**
 * Local Storage Management
 */
function getTrackedOptions() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading from localStorage:', error);
    return [];
  }
}

function saveTrackedOptions(options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

/**
 * Simulate live SENSEX and volatility data
 */
function generateLiveData() {
  const basePrice = 75423;
  const randomChange = (Math.random() - 0.5) * 200;
  const price = basePrice + randomChange;
  const changePercent = ((randomChange / basePrice) * 100).toFixed(2);
  
  return {
    sensex: Math.round(price),
    volatility: (Math.random() * 25 + 10).toFixed(2),
    change: randomChange.toFixed(2),
    changePercent: changePercent,
    marketStatus: isMarketOpen() ? 'OPEN' : 'CLOSED',
    optionsActive: isMarketOpen(),
    lastUpdate: new Date(),
    source: 'Simulated Data',
    error: null
  };
}

/**
 * Check if market is open (IST timezone - 9:15 AM to 3:30 PM, Monday to Friday)
 */
function isMarketOpen() {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dayOfWeek = istTime.getDay();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  const marketOpen = 9 * 60 + 15; // 555 (9:15 AM)
  const marketClose = 15 * 60 + 30; // 930 (3:30 PM)
  
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  return isWeekday && timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
}

/**
 * Load and display live SENSEX and volatility data
 */
function loadLiveData() {
  try {
    const data = generateLiveData();
    
    // Update ticker items with live prices
    const tickerItems = document.querySelectorAll('.ticker-item');
    if (tickerItems.length >= 3) {
      // SENSEX price
      const direction = data.changePercent >= 0 ? '▲' : '▼';
      const priceDisplay = `SENSEX ${direction} ${data.sensex?.toLocaleString() || 75423}`;
      tickerItems[0].textContent = priceDisplay;
      tickerItems[0].style.color = data.changePercent >= 0 ? '#10b981' : '#ef4444';
      
      // Volatility
      tickerItems[1].textContent = `VOLATILITY ▲ ${data.volatility || 18.5}%`;
      
      // Market Status (OPEN/CLOSED)
      const statusText = data.optionsActive ? 'OPTIONS ▲ ACTIVE' : 'OPTIONS ● CLOSED';
      const statusColor = data.optionsActive ? '#10b981' : '#ef4444';
      tickerItems[2].textContent = statusText;
      tickerItems[2].style.color = statusColor;
    }
    
    // Log market info
    console.log(`📊 Market: ${data.marketStatus} | Options: ${data.optionsActive ? 'ACTIVE' : 'CLOSED'} | Last Update: ${new Date(data.lastUpdate).toLocaleTimeString()}`);
  } catch (error) {
    console.warn('Error generating live data:', error);
  }
}

// Event Listeners
addOptionForm.addEventListener('submit', handleAddOption);
priceForm.addEventListener('submit', handlePriceUpdate);
closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', closeOnOutsideClick);

// Prevent zoom on double tap
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, false);

// Prevent iOS input zoom
if (isMobileDevice()) {
  document.addEventListener('touchstart', (e) => {
    if (e.target.matches('input, select, textarea')) {
      e.target.style.fontSize = '16px';
    }
  });
}

/**
 * Handle adding a new option
 */
function handleAddOption(e) {
  e.preventDefault();

  const formData = {
    optionType: document.getElementById('optionType').value,
    strike: parseFloat(document.getElementById('strike').value),
    entryPrice: parseFloat(document.getElementById('entryPrice').value),
    quantity: parseInt(document.getElementById('quantity').value),
    trailingPercent: parseFloat(document.getElementById('trailingPercent').value)
  };

  try {
    if (!formData.optionType || !formData.strike || !formData.entryPrice || !formData.quantity || !formData.trailingPercent) {
      showNotification('Please fill all required fields', 'error');
      return;
    }

    const option = {
      id: Date.now(),
      entryPrice: formData.entryPrice,
      currentPrice: formData.entryPrice,
      quantity: formData.quantity,
      trailingPercent: formData.trailingPercent,
      optionType: formData.optionType,
      strike: formData.strike,
      highestPrice: formData.entryPrice,  // Tracks highest observed premium for trailing stop (both CALL & PUT)
      stoploss: calculateStoploss(formData.entryPrice, formData.trailingPercent),
      status: 'TRACKING',
      createdAt: new Date().toISOString(),
      updateLog: []
    };

    const options = getTrackedOptions();
    options.push(option);
    saveTrackedOptions(options);
    
    addOptionForm.reset();
    loadOptions();
    showNotification('Option added successfully!', 'success');
  } catch (error) {
    console.error('Error adding option:', error);
    showNotification('Failed to add option', 'error');
  }
}

/**
 * Calculate stoploss as a trailing stop below the observed peak premium.
 * This returns a price lower than the tracked highestPrice so stoploss
 * is always below the market price for profit-booking (works for both CALL and PUT).
 * Formula: highestPrice * (1 - trailingPercent)
 */
function calculateStoploss(price, trailingPercent) {
  return price * (1 - trailingPercent / 100);
}

/**
 * Load and display all tracked options
 */
function loadOptions() {
  if (isRefreshing) return;
  
  isRefreshing = true;
  try {
    const options = getTrackedOptions();

    if (options.length === 0) {
      optionsContainer.innerHTML = '<div class="no-data">No options tracked yet. Add one to get started!</div>';
      updateStats(options);
      isRefreshing = false;
      return;
    }

    optionsContainer.innerHTML = options.map(option => createOptionCard(option)).join('');
    attachEventListeners();
    updateStats(options);
  } catch (error) {
    console.error('Error loading options:', error);
    optionsContainer.innerHTML = '<div class="no-data">Error loading options</div>';
  } finally {
    isRefreshing = false;
  }
}

/**
 * Create HTML for an option card
 */
function createOptionCard(option) {
  const pnl = calculatePnL(option);
  const distance = getDistanceToStoploss(option);
  const distancePercent = getDistancePercent(option);
  const isNearStoploss = distancePercent < 2;
  const isHit = isStoplossHit(option);

  const statusClass = `status-${option.status.toLowerCase().replace(/_/g, '-')}`;
  const typeClass = option.optionType.toLowerCase();

  return `
    <div class="option-card" data-id="${option.id}">
      <div class="option-header">
        <div>
          <span class="option-type ${typeClass}">${option.optionType}</span>
          <span class="option-status ${statusClass}">${option.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <div class="option-info">
        <div class="info-item">
          <div class="info-label">Strike</div>
          <div class="info-value strike">₹${formatNumber(option.strike)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Quantity</div>
          <div class="info-value strike">${option.quantity}</div>
        </div>
      </div>

      <div class="price-section">
        <div class="price-row">
          <span class="price-label">Entry Price</span>
          <span class="price-value">₹${formatNumber(option.entryPrice)}</span>
        </div>
        <div class="price-row">
          <span class="price-label">Current Price</span>
          <span class="price-value ${pnl.pnl >= 0 ? 'positive' : 'negative'}">₹${formatNumber(option.currentPrice)}</span>
        </div>
        <div class="price-row">
          <span class="price-label">Highest Price</span>
          <span class="price-value positive">₹${formatNumber(option.highestPrice)}</span>
        </div>
        <div class="price-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.05);">
          <span class="price-label">P&L</span>
          <span class="price-value ${pnl.pnl >= 0 ? 'positive' : 'negative'}">₹${pnl.pnl} (${pnl.pnlPercent}%)</span>
        </div>
      </div>

      ${renderStoplossAlert(option, distance, distancePercent, isNearStoploss, isHit)}

      <div class="option-info" style="margin-bottom: 15px;">
        <div class="info-item">
          <div class="info-label">Trailing %</div>
          <div class="info-value strike">${option.trailingPercent}%</div>
        </div>
        <div class="info-item">
          <div class="info-label">Distance %</div>
          <div class="info-value strike" style="color: ${getDistanceColor(distancePercent)}">${distancePercent.toFixed(2)}%</div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn-small btn-update update-btn" data-id="${option.id}">💲 Update Price</button>
        <button class="btn-small btn-exit exit-btn" data-id="${option.id}" ${option.status !== 'TRACKING' ? 'disabled' : ''}>🚪 Exit</button>
        <button class="btn-small btn-remove remove-btn" data-id="${option.id}">🗑️ Remove</button>
      </div>
    </div>
  `;
}

/**
 * Render stoploss alert section
 */
function renderStoplossAlert(option, distance, distancePercent, isNearStoploss, isHit) {
  let alertClass = 'safe';
  let alertText = '';

  if (isHit) {
    alertClass = 'warning';
    alertText = `⚠️ STOPLOSS HIT! Price (₹${formatNumber(option.currentPrice)}) has touched stoploss (₹${formatNumber(option.stoploss)})`;
  } else if (isNearStoploss) {
    alertClass = 'warning';
    alertText = `⚠️ WARNING! Only ₹${formatNumber(distance)} (${distancePercent.toFixed(2)}%) away from stoploss`;
  } else {
    alertText = `✓ Stoploss: ₹${formatNumber(option.stoploss)}`;
  }

  return `
    <div class="stoploss-alert ${alertClass}">
      <div class="stoploss-text ${alertClass}">${alertText}</div>
    </div>
  `;
}

/**
 * Attach event listeners to dynamically created elements
 */
function attachEventListeners() {
  // Update price buttons
  document.querySelectorAll('.update-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentOptionId = e.target.dataset.id;
      openModal();
    });
  });

  // Exit buttons
  document.querySelectorAll('.exit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (confirm('Exit this position now?')) {
        await exitOption(id);
      }
    });
  });

  // Remove buttons
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (confirm('Remove this option from tracking?')) {
        await removeOption(id);
      }
    });
  });
}

/**
 * Handle price update
 */
function handlePriceUpdate(e) {
  e.preventDefault();

  const newPrice = parseFloat(document.getElementById('newPrice').value);

  try {
    const options = getTrackedOptions();
    const option = options.find(opt => opt.id === parseInt(currentOptionId));

    if (!option) {
      showNotification('Option not found', 'error');
      return;
    }

    const oldHighest = option.highestPrice;
    const oldStoploss = option.stoploss;

    // For both CALL and PUT we track the highest observed premium so the
    // trailing stoploss always sits below that peak (profit booking on downside).
    if (newPrice > option.highestPrice) {
      option.highestPrice = newPrice;
    }
    // Recalculate stoploss based on highestPrice (always below it)
    option.stoploss = calculateStoploss(option.highestPrice, option.trailingPercent);

    option.currentPrice = newPrice;

    // Log the update
    option.updateLog.push({
      timestamp: new Date().toISOString(),
      previousPrice: oldHighest,
      newPrice: newPrice,
      stoploss: option.stoploss,
      pnl: calculatePnL(option)
    });

    // Check if stoploss is hit
    if (isStoplossHit(option)) {
      option.status = 'STOPLOSS_HIT';
    }

    saveTrackedOptions(options);
    loadOptions();
    closeModal();
    showNotification('Price updated successfully!', 'success');
  } catch (error) {
    console.error('Error updating price:', error);
    showNotification('Failed to update price', 'error');
  }
}

/**
 * Exit an option
 */
function exitOption(id) {
  try {
    const options = getTrackedOptions();
    const option = options.find(opt => opt.id === parseInt(id));

    if (!option) {
      showNotification('Option not found', 'error');
      return;
    }

    option.status = 'EXITED';
    option.exitPrice = option.currentPrice;
    option.exitedAt = new Date().toISOString();
    option.finalPnL = calculatePnL(option);

    saveTrackedOptions(options);
    loadOptions();
    showNotification('Position exited successfully!', 'success');
  } catch (error) {
    console.error('Error exiting option:', error);
    showNotification('Failed to exit position', 'error');
  }
}

/**
 * Remove an option from tracking
 */
function removeOption(id) {
  try {
    let options = getTrackedOptions();
    const index = options.findIndex(opt => opt.id === parseInt(id));

    if (index === -1) {
      showNotification('Option not found', 'error');
      return;
    }

    options.splice(index, 1);
    saveTrackedOptions(options);
    loadOptions();
    showNotification('Option removed from tracking', 'success');
  } catch (error) {
    console.error('Error removing option:', error);
    showNotification('Failed to remove option', 'error');
  }
}

/**
 * Update statistics
 */
function updateStats(options) {
  const stats = {
    total: options.length,
    active: options.filter(opt => opt.status === 'TRACKING').length,
    stoploss: options.filter(opt => opt.status === 'STOPLOSS_HIT').length,
    exited: options.filter(opt => opt.status === 'EXITED').length
  };

  document.getElementById('totalTracked').textContent = stats.total;
  document.getElementById('totalActive').textContent = stats.active;
  document.getElementById('totalStoploss').textContent = stats.stoploss;
  document.getElementById('totalExited').textContent = stats.exited;
}

/**
 * Helper Functions
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

function getDistanceToStoploss(option) {
  // Distance from current price down to stoploss (always currentPrice - stoploss)
  return option.currentPrice - option.stoploss;
}

function getDistancePercent(option) {
  const distance = getDistanceToStoploss(option);
  const percent = (distance / option.currentPrice) * 100;
  return Math.max(0, percent);
}

function getDistanceColor(percent) {
  if (percent < 2) return '#ef4444'; // Red
  if (percent < 5) return '#f59e0b'; // Orange
  return '#10b981'; // Green
}

function isStoplossHit(option) {
  // Stoploss is considered hit when current price falls to or below the stoploss
  return option.currentPrice <= option.stoploss;
}

function formatNumber(num) {
  return parseFloat(num).toFixed(2);
}

/**
 * Modal Functions
 */

function openModal() {
  priceModal.style.display = 'block';
  document.getElementById('newPrice').focus();
}

function closeModal() {
  priceModal.style.display = 'none';
  document.getElementById('newPrice').value = '';
  currentOptionId = null;
}

function closeOnOutsideClick(event) {
  if (event.target === priceModal) {
    closeModal();
  }
}

/**
 * Notification
 */

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.textContent = message;
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#0ea5e9'
  };
  
  const bgColor = colors[type] || colors.info;
  const maxWidth = isMobileDevice() ? '90vw' : '350px';
  const bottom = isMobileDevice() ? '20px' : 'auto';
  const top = isMobileDevice() ? 'auto' : '20px';
  
  notification.style.cssText = `
    position: fixed;
    top: ${top};
    right: 20px;
    bottom: ${bottom};
    padding: 16px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: clamp(0.9rem, 2vw, 1rem);
    z-index: 2000;
    animation: slideIn 0.3s ease;
    background: ${bgColor};
    color: white;
    max-width: ${maxWidth};
    word-break: break-word;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Initialize app
 */
function init() {
  console.log('✓ Sensex Options Tracker initialized (Pure Frontend)');
  console.log('Mobile device:', isMobileDevice());
  
  loadOptions();
  loadLiveData();

  // Auto-refresh with adaptive interval
  const refreshInterval_ms = isMobileDevice() ? 7000 : 5000;
  refreshInterval = setInterval(() => {
    loadOptions();
    loadLiveData();
  }, refreshInterval_ms);

  // Pause refresh on app background (mobile optimization)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (refreshInterval) clearInterval(refreshInterval);
      console.log('App backgrounded, refresh paused');
    } else {
      // Resume refresh when app comes to foreground
      if (!refreshInterval) {
        const refreshInterval_ms = isMobileDevice() ? 7000 : 5000;
        refreshInterval = setInterval(() => {
          loadOptions();
          loadLiveData();
        }, refreshInterval_ms);
        console.log('App resumed, refresh restarted');
        loadOptions();
        loadLiveData();
      }
    }
  });

  // Handle app pause/resume for better mobile battery life
  if (isMobileDevice()) {
    window.addEventListener('pagehide', () => {
      if (refreshInterval) clearInterval(refreshInterval);
    });

    window.addEventListener('pageshow', () => {
      if (!refreshInterval) {
        const refreshInterval_ms = isMobileDevice() ? 7000 : 5000;
        refreshInterval = setInterval(() => {
          loadOptions();
          loadLiveData();
        }, refreshInterval_ms);
      }
    });
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
