const responseCache = new Map();

function buildCacheKey(namespace, payload = "") {
    return `${namespace}::${payload}`;
}

function getCached(cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        responseCache.delete(cacheKey);
        return null;
    }
    return cached.value;
}

function setCached(cacheKey, value, ttlMs) {
    responseCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
}

async function getOrSetCache(cacheKey, ttlMs, fetcher) {
    const fromCache = getCached(cacheKey);
    if (fromCache !== null) return fromCache;
    const value = await fetcher();
    return setCached(cacheKey, value, ttlMs);
}

async function getOrSetCacheIf(cacheKey, ttlMs, fetcher, shouldCache) {
    const fromCache = getCached(cacheKey);
    if (fromCache !== null) return fromCache;
    const value = await fetcher();
    if (shouldCache(value)) setCached(cacheKey, value, ttlMs);
    return value;
}

async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

async function fetchYahooData(ticker, range = "2y", interval = "1d", p50 = 50, p200 = 200) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if (!data?.chart?.result?.[0]) return [];
        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quotes = result.indicators.quote[0] || {};
        
        let points = timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            open: Number(quotes.open[i]), high: Number(quotes.high[i]), low: Number(quotes.low[i]),
            close: Number(quotes.close[i]), value: Number(quotes.close[i]), volume: Number(quotes.volume[i]) 
        })).filter(p => !isNaN(p.close) && p.close !== null && p.close > 0);

        return points.map((point, i, arr) => {
            let ma50_val = null, ma200_val = null;
            if (i >= p50 - 1) {
                let sum = 0; for (let j = 0; j < p50; j++) sum += arr[i - j].close;
                ma50_val = Number((sum / p50).toFixed(2));
            }
            if (i >= p200 - 1) {
                let sum = 0; for (let j = 0; j < p200; j++) sum += arr[i - j].close;
                ma200_val = Number((sum / p200).toFixed(2));
            }
            return { ...point, ma50: ma50_val, ma200: ma200_val };
        });
    } catch (e) { return []; }
}

async function fetchYahooQuote(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await res.json();
        if (!data?.chart?.result?.[0]) return null;
        const result = data.chart.result[0];
        const quotes = result.indicators.quote[0] || {};
        const meta = result.meta || {};
        const closePrice = quotes.close ? quotes.close[quotes.close.length - 1] : meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        if (!closePrice) return null;
        return { c: closePrice, dp: prevClose ? ((closePrice - prevClose) / prevClose) * 100 : 0 };
    } catch (e) { return null; }
}

const SCREENER_UNIVERSES = {
    day_gainers: ['NVDA','TSLA','META','AMZN','GOOGL','MSFT','AAPL','AMD','PLTR','ARM','SMCI','AVGO','TSM','MSTR','COIN'],
    day_losers: ['INTC','BA','PFE','WBA','VFC','MRK','CVS','T','F','GM','PARA','RIVN','NIO','PYPL','PINS'],
    most_actives: ['SPY','QQQ','AAPL','TSLA','NVDA','AMD','BAC','F','PLTR','SOFI','NIO','AAL','RIVN','MARA','RIOT'],
    undervalued_growth_equities: ['META','GOOGL','BABA','JD','PYPL','EBAY','WBD','QCOM','MU','AMAT','CSCO','HPQ','IBM','WDC','NTAP'],
    aggressive_small_caps: ['IONQ','RGTI','QUBT','SOUN','BBAI','SERV','RKLB','ACHR','OPEN','CLOV','HIMS','HOOD','UPST','U','DNA']
};

async function fetchYahooScreener(scrId) {
    const tickers = SCREENER_UNIVERSES[scrId] || SCREENER_UNIVERSES.day_gainers;
    try {
        const results = await Promise.allSettled(tickers.map(async (sym) => {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await res.json();
            const meta = data?.chart?.result?.[0]?.meta;
            if (!meta?.regularMarketPrice || !meta?.chartPreviousClose) return null;
            return {
                symbol: sym,
                name: meta.longName || meta.shortName || sym,
                price: Number(meta.regularMarketPrice),
                changesPercentage: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
            };
        }));
        let quotes = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
        if (scrId === 'day_losers') {
            quotes = quotes.filter(q => Number(q.changesPercentage) < 0);
            quotes.sort((a,b) => a.changesPercentage - b.changesPercentage);
        } else if (scrId === 'day_gainers') {
            quotes = quotes.filter(q => Number(q.changesPercentage) > 0);
            quotes.sort((a,b) => b.changesPercentage - a.changesPercentage);
        } else {
            quotes.sort((a,b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage));
        }
        return quotes.slice(0, 12);
    } catch(e) { return []; }
}

function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return 50; 
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let change = prices[i] - prices[i - 1];
        if (change > 0) gains += change; else losses -= change;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0, loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
}

function extractKeyLevels(points) {
    if (points.length < 50) return [];
    let levels = [];
    const window = 15; 
    for (let i = window; i < points.length - window; i++) {
        const p = points[i];
        let isHigh = true, isLow = true;
        for (let j = 1; j <= window; j++) {
            if (p.high <= points[i-j].high || p.high <= points[i+j].high) isHigh = false;
            if (p.low >= points[i-j].low || p.low >= points[i+j].low) isLow = false;
        }
        if (isHigh) levels.push({ price: p.high, type: 'התנגדות קרובה' });
        if (isLow) levels.push({ price: p.low, type: 'תמיכה קרובה' });
    }
    const currentPrice = points[points.length - 1].close;
    let above = levels.filter(l => l.price > currentPrice * 1.01 && l.type.includes('התנגדות')).sort((a,b) => a.price - b.price);
    let below = levels.filter(l => l.price < currentPrice * 0.99 && l.type.includes('תמיכה')).sort((a,b) => b.price - a.price);
    
    let finalLevels = [];
    if (above.length > 0) finalLevels.push(above[0]); 
    if (below.length > 0) finalLevels.push(below[0]); 
    return finalLevels; 
}

function detectAllPatterns(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return { text: "אין מספיק נתונים", lines: [] };
    const last40 = chartPoints.slice(-40);
    const currentPrice = chartPoints[chartPoints.length - 1].close;
    let patterns = []; let lines = []; 

    const curr = chartPoints[chartPoints.length - 1];
    const prev = chartPoints[chartPoints.length - 2];
    if (curr.ma50 && curr.ma200 && prev.ma50 && prev.ma200) {
        if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) patterns.push("חיתוך זהב (Golden Cross) 📈");
        if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) patterns.push("חיתוך מוות (Death Cross) 📉");
    }

    let max1 = {val: 0, time: ''}, max2 = {val: 0, time: ''};
    let min1 = {val: 999999, time: ''}, min2 = {val: 999999, time: ''};

    for(let i=0; i<20; i++) {
        if(last40[i].high > max1.val) { max1.val = last40[i].high; max1.time = last40[i].date; }
        if(last40[i].low < min1.val) { min1.val = last40[i].low; min1.time = last40[i].date; }
    }
    for(let i=20; i<40; i++) {
        if(last40[i].high > max2.val) { max2.val = last40[i].high; max2.time = last40[i].date; }
        if(last40[i].low < min2.val) { min2.val = last40[i].low; min2.time = last40[i].date; }
    }

    const h1 = max1.val, h2 = max2.val, l1 = min1.val, l2 = min2.val;

    if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < h1 * 0.96) {
        patterns.push("פסגה כפולה (Double Top) ⛰️⛰️");
    }
    if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > l1 * 1.04) {
        patterns.push("תחתית כפולה (Double Bottom) 🕳️🕳️");
    }
    
    const isRising = h2 > h1 && l2 > l1, isFalling = h2 < h1 && l2 < l1, converge = (h1 - l1) > (h2 - l2) * 1.2; 

    if (isRising && converge) {
        patterns.push("יתד עולה (Rising Wedge) 📐⬇️");
    } else if (isFalling && converge) {
        patterns.push("יתד יורד (Falling Wedge) 📐⬆️");
    } else if (isRising && !converge) {
        patterns.push("תעלה עולה (Ascending Channel) ↗️");
    } else if (isFalling && !converge) {
        patterns.push("תעלה יורדת (Descending Channel) ↘️");
    }
    
    const text = patterns.length === 0 ? "דשדוש (Consolidation) ↔️" : [...new Set(patterns)].join(" | ");
    return { text, lines };
}

function sanitizeValue(val) {
    if (val === null || val === undefined || isNaN(val) || val === '') return null;
    return Number(val);
}

function getSectorETF(sectorName) {
    const map = {
        "Technology": "XLK", "Healthcare": "XLV", "Financials": "XLF", 
        "Consumer Cyclical": "XLY", "Industrials": "XLI", "Energy": "XLE", 
        "Consumer Defensive": "XLP", "Utilities": "XLU", "Real Estate": "XLRE", "Basic Materials": "XLB"
    };
    return map[sectorName] || "SPY"; 
}

function calculateRelativeStrength(stockPoints, spyPoints) {
    if (!stockPoints || !spyPoints || stockPoints.length < 21 || spyPoints.length < 21) return 0;
    const stockReturn = (stockPoints[stockPoints.length - 1].close - stockPoints[stockPoints.length - 21].close) / stockPoints[stockPoints.length - 21].close;
    const spyReturn = (spyPoints[spyPoints.length - 1].close - spyPoints[spyPoints.length - 21].close) / spyPoints[spyPoints.length - 21].close;
    return ((stockReturn - spyReturn) * 100).toFixed(2);
}

function clampNumber(value, min = 0, max = 100, fallback = 50) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function scoreLowerBetter(value, good, bad) {
    if (value === null || value === undefined || value === '') return null;
    if (!Number.isFinite(Number(value))) return null;
    const v = Number(value);
    if (v <= good) return 95;
    if (v >= bad) return 20;
    return Math.round(95 - ((v - good) / (bad - good)) * 75);
}

function scoreHigherBetter(value, bad, good) {
    if (value === null || value === undefined || value === '') return null;
    if (!Number.isFinite(Number(value))) return null;
    const v = Number(value);
    if (v >= good) return 95;
    if (v <= bad) return 20;
    return Math.round(20 + ((v - bad) / (good - bad)) * 75);
}

function scoreRange(value, low, high, idealLow, idealHigh) {
    if (value === null || value === undefined || value === '') return null;
    if (!Number.isFinite(Number(value))) return null;
    const v = Number(value);
    if (v >= idealLow && v <= idealHigh) return 90;
    if (v < low || v > high) return 25;
    if (v < idealLow) return Math.round(25 + ((v - low) / (idealLow - low)) * 65);
    return Math.round(90 - ((v - idealHigh) / (high - idealHigh)) * 65);
}

function weightedAverage(items, fallback = 50) {
    const valid = items.filter(item => Number.isFinite(item.score));
    if (valid.length === 0) return fallback;
    const totalWeight = valid.reduce((sum, item) => sum + (item.weight || 1), 0);
    const total = valid.reduce((sum, item) => sum + item.score * (item.weight || 1), 0);
    return Math.round(total / totalWeight);
}

function trailingReturn(points, sessions) {
    if (!Array.isArray(points) || points.length <= sessions) return null;
    const last = points[points.length - 1]?.close;
    const prior = points[points.length - 1 - sessions]?.close;
    if (!last || !prior) return null;
    return ((last / prior) - 1) * 100;
}

function calculateATR(points, period = 14) {
    if (!Array.isArray(points) || points.length <= period) return null;
    const slice = points.slice(-(period + 1));
    let total = 0;
    for (let i = 1; i < slice.length; i++) {
        const current = slice[i];
        const previous = slice[i - 1];
        const trueRange = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );
        total += trueRange;
    }
    return total / period;
}

function ratingFromScore(score) {
    if (score >= 82) return "קנייה חזקה";
    if (score >= 65) return "קנייה";
    if (score <= 38) return "מכירה";
    return "החזקה";
}

function formatDollar(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : "N/A";
}

function parsePrice(value) {
    const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function buildRiskLevels(currPrice, chartPoints, keyLevels) {
    const atr = calculateATR(chartPoints) || currPrice * 0.035;
    const resistance = (keyLevels || []).filter(l => l.type.includes('התנגדות') && l.price > currPrice).sort((a,b) => a.price - b.price)[0]?.price;
    const support = (keyLevels || []).filter(l => l.type.includes('תמיכה') && l.price < currPrice).sort((a,b) => b.price - a.price)[0]?.price;
    const target = resistance || Math.max(currPrice + atr * 2.2, currPrice * 1.06);
    const stop = support || Math.max(currPrice - atr * 1.6, currPrice * 0.9);
    return {
        atr: Number(atr.toFixed(2)),
        target: Number(target.toFixed(2)),
        stop: Number(Math.min(stop, currPrice * 0.98).toFixed(2))
    };
}

function normalizeTradePlan(plan, currPrice, riskLevels) {
    const next = { ...(plan || {}) };
    const target = parsePrice(next.target_price);
    const stop = parsePrice(next.stop_loss);
    next.entry_price = formatDollar(currPrice);
    if (!target || target <= currPrice || target > currPrice * 1.45) next.target_price = formatDollar(riskLevels.target);
    if (!stop || stop >= currPrice || stop < currPrice * 0.65) next.stop_loss = formatDollar(riskLevels.stop);
    return next;
}

function normalizeLongTermPlan(plan, priceTargetData, currPrice, quantScorecard) {
    const next = { ...(plan || {}) };
    if (Number.isFinite(Number(priceTargetData?.targetMedian))) {
        next.price_target = formatDollar(Number(priceTargetData.targetMedian));
    } else {
        const existingTarget = parsePrice(next.price_target);
        if (!existingTarget && Number.isFinite(currPrice) && currPrice > 0) {
            const score = Number(quantScorecard?.scores?.overall || 50);
            let multiplier = 1.03;
            if (score >= 65) multiplier = 1.10 + Math.min(0.18, (score - 65) / 100);
            else if (score <= 38) multiplier = 0.88;
            next.price_target = formatDollar(currPrice * multiplier);
        }
    }
    if (!parsePrice(next.intrinsic_value) && Number.isFinite(currPrice) && currPrice > 0) {
        next.intrinsic_value = formatDollar(currPrice * 1.04);
    }
    if ((!next.accumulation_zone || next.accumulation_zone === "N/A") && Number.isFinite(currPrice) && currPrice > 0) {
        next.accumulation_zone = `${formatDollar(currPrice * 0.92)} - ${formatDollar(currPrice * 0.98)}`;
    }
    return next;
}

function buildQuantScorecard({ fundamentals, currPrice, chartPointsDaily, spyPointsDaily, rsiVal, relativeStrength, keyLevels, priceTargetData, earningsData, insiderSentiment }) {
    const lastPoint = chartPointsDaily[chartPointsDaily.length - 1] || {};
    const above50 = Number.isFinite(lastPoint.ma50) && currPrice >= lastPoint.ma50;
    const above200 = Number.isFinite(lastPoint.ma200) && currPrice >= lastPoint.ma200;
    const oneMonth = trailingReturn(chartPointsDaily, 21);
    const sixMonth = trailingReturn(chartPointsDaily, 126);
    const rs = Number(relativeStrength);
    const peGood = fundamentals.revenueGrowth > 18 ? 28 : 18;
    const peBad = fundamentals.revenueGrowth > 18 ? 70 : 45;
    const analystUpside = Number.isFinite(Number(priceTargetData?.targetMedian)) ? ((Number(priceTargetData.targetMedian) / currPrice) - 1) * 100 : null;
    const recentEarnings = Array.isArray(earningsData) ? earningsData.slice(0, 4).filter(e => Number.isFinite(Number(e.surprisePercent))) : [];
    const earningsBeatRate = recentEarnings.length ? (recentEarnings.filter(e => e.surprisePercent > 0).length / recentEarnings.length) * 100 : null;

    const valuation = weightedAverage([
        { score: scoreLowerBetter(fundamentals.peRatio, peGood, peBad), weight: 1.5 },
        { score: scoreLowerBetter(fundamentals.psRatio, 3, 14), weight: 1 },
        { score: scoreLowerBetter(fundamentals.pbRatio, 3, 12), weight: 0.8 },
        { score: scoreHigherBetter(analystUpside, -15, 30), weight: 1.2 }
    ]);

    const financials = weightedAverage([
        { score: scoreHigherBetter(fundamentals.currentRatio, 0.8, 2.2), weight: 1 },
        { score: scoreHigherBetter(fundamentals.quickRatio, 0.6, 1.5), weight: 1 },
        { score: scoreLowerBetter(fundamentals.debtToEquity, 0.6, 3), weight: 1.4 },
        { score: scoreRange(fundamentals.beta, 0, 2.6, 0.7, 1.4), weight: 0.6 }
    ]);

    const profitability = weightedAverage([
        { score: scoreHigherBetter(fundamentals.grossMargin, 15, 55), weight: 0.8 },
        { score: scoreHigherBetter(fundamentals.operatingMargin, 3, 28), weight: 1.2 },
        { score: scoreHigherBetter(fundamentals.netMargin, 0, 22), weight: 1.2 },
        { score: scoreHigherBetter(fundamentals.roe, 5, 25), weight: 1 },
        { score: scoreHigherBetter(fundamentals.roic, 4, 18), weight: 1.2 }
    ]);

    const growth = weightedAverage([
        { score: scoreHigherBetter(fundamentals.revenueGrowth, -5, 25), weight: 1.3 },
        { score: scoreHigherBetter(fundamentals.epsGrowth5Y, -5, 25), weight: 1 },
        { score: scoreHigherBetter(earningsBeatRate, 25, 90), weight: 0.8 }
    ]);

    const momentum = weightedAverage([
        { score: above50 ? 76 : 34, weight: 1 },
        { score: above200 ? 80 : 30, weight: 1.1 },
        { score: scoreHigherBetter(rs, -12, 18), weight: 1.3 },
        { score: scoreRange(rsiVal, 20, 85, 42, 66), weight: 0.9 },
        { score: scoreHigherBetter(oneMonth, -12, 16), weight: 0.8 },
        { score: scoreHigherBetter(sixMonth, -25, 35), weight: 0.8 }
    ]);

    const quality = weightedAverage([
        { score: profitability, weight: 1.4 },
        { score: financials, weight: 1 },
        { score: growth, weight: 0.8 }
    ]);

    let overall = weightedAverage([
        { score: valuation, weight: 0.18 },
        { score: financials, weight: 0.15 },
        { score: profitability, weight: 0.22 },
        { score: growth, weight: 0.2 },
        { score: momentum, weight: 0.25 }
    ]);

    if (insiderSentiment === 'שלילי (מכירות)') overall = Math.max(0, overall - 4);
    if (insiderSentiment === 'חיובי (קניות)') overall = Math.min(100, overall + 3);

    const metricValues = [
        fundamentals.peRatio, fundamentals.psRatio, fundamentals.pbRatio, fundamentals.revenueGrowth,
        fundamentals.operatingMargin, fundamentals.netMargin, fundamentals.roe, fundamentals.roic,
        fundamentals.currentRatio, fundamentals.quickRatio, fundamentals.debtToEquity, lastPoint.ma50,
        lastPoint.ma200, rsiVal, relativeStrength, priceTargetData?.targetMedian
    ];
    const availableMetrics = metricValues.filter(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))).length;
    const confidence = clampNumber(35 + availableMetrics * 3.5 + (chartPointsDaily.length >= 200 ? 10 : 0) + (recentEarnings.length >= 2 ? 6 : 0), 35, 92);
    const riskLevels = buildRiskLevels(currPrice, chartPointsDaily, keyLevels);

    return {
        scores: {
            overall: Math.round(overall),
            valuation, value: valuation,
            financials,
            profitability, quality,
            growth,
            momentum
        },
        confidence_score: Math.round(confidence),
        data_quality: {
            available_metrics: availableMetrics,
            total_metrics: metricValues.length,
            chart_points: chartPointsDaily.length
        },
        risk_levels: riskLevels,
        drivers: [
            { label: "מומנטום", value: above50 && above200 ? "המחיר מעל MA50 ו-MA200" : !above50 && !above200 ? "המחיר מתחת לשני הממוצעים" : "המגמה מעורבת", score: momentum },
            { label: "עוצמה יחסית", value: `${rs > 0 ? "+" : ""}${Number.isFinite(rs) ? rs.toFixed(2) : "0.00"}% מול SPY בחודש`, score: scoreHigherBetter(rs, -12, 18) || 50 },
            { label: "תמחור", value: `P/E ${fundamentals.peRatio || "N/A"} · P/S ${fundamentals.psRatio || "N/A"}`, score: valuation },
            { label: "רווחיות", value: `Operating ${fundamentals.operatingMargin || "N/A"}% · ROIC ${fundamentals.roic || "N/A"}%`, score: profitability }
        ]
    };
}

function cleanJSON(text) {
    try {
        let cleaned = String(text || '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            cleaned = cleaned.substring(start, end + 1);
        }
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleaned);
    } catch (e) { 
        console.error("❌ שגיאת JSON מקלוד:", e.message);
        console.error("📝 הטקסט המלא שגרם לקריסה:\n", text); 
        return null; 
    }
}

async function fetchClaudeJson(anthropicKey, promptText) {
    const modelCandidates = [
        process.env.ANTHROPIC_MODEL,
        'claude-haiku-4-5-20251001',
        'claude-3-5-haiku-latest',
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307'
    ].filter(Boolean);

    const invoke = async (userPrompt, model) => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model,
                max_tokens: 1000,
                temperature: 0.05,
                system: "Return strictly valid minified JSON only. No markdown, no prose, no code fences.",
                messages: [{ role: 'user', content: userPrompt }]
            })
        });
        const payload = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, payload, model };
    };

    let lastError = null;
    for (const model of modelCandidates) {
        const first = await invoke(promptText, model);
        const parsedFirst = cleanJSON(first?.payload?.content?.[0]?.text || '');
        if (parsedFirst) return { parsed: parsedFirst, model };

        const retryPrompt = `${promptText}\n\nIMPORTANT: Output one valid JSON object only.`;
        const second = await invoke(retryPrompt, model);
        const parsedSecond = cleanJSON(second?.payload?.content?.[0]?.text || '');
        if (parsedSecond) return { parsed: parsedSecond, model };

        lastError = second?.payload?.error || first?.payload?.error || {
            message: `Claude model ${model} failed (HTTP ${second?.status || first?.status || 'unknown'})`
        };
    }
    return { parsed: null, error: lastError };
}

async function fetchGeminiJson(geminiKey, promptText, temperature = 0.05) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const invoke = async (userPrompt) => {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                generationConfig: { temperature, responseMimeType: "application/json" }
            })
        });
        const payload = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, payload, model };
    };

    const first = await invoke(promptText);
    const firstText = first?.payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsedFirst = cleanJSON(firstText);
    if (parsedFirst) return { parsed: parsedFirst, model };

    const retryPrompt = `${promptText}\n\nIMPORTANT: Output one valid minified JSON object only.`;
    const second = await invoke(retryPrompt);
    const secondText = second?.payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsedSecond = cleanJSON(secondText);
    if (parsedSecond) return { parsed: parsedSecond, model };

    return {
        parsed: null,
        error: second?.payload?.error || first?.payload?.error || {
            message: firstText || secondText || `Gemini model ${model} failed (HTTP ${second?.status || first?.status || 'unknown'})`
        }
    };
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "").toUpperCase().trim();
        const action = req.query.action;
        const shouldRunAI = req.query.ai !== '0';
        const aiMode = String(req.query.ai_mode || 'smart').toLowerCase();
        
        const geminiKey = process.env.GEMINI_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.trim() : null; 
        const finnhubKey = process.env.FINNHUB_API_KEY;

        if (!geminiKey || !finnhubKey) return res.status(200).json({ success: false, message: "Missing API Keys" });

        // --- תיק מניות כריש ---
        if (action === 'shark_portfolio') {
            const prompt = `You are "FinShark", an elite Wall Street AI hedge fund manager. 
            Construct a 5-stock model portfolio for today's market environment. 
            Choose real, highly traded US stocks. Balance it between Growth, Value, and Momentum.
            
            Return ONLY a valid JSON array in Hebrew. Format exactly like this:
            [
              {"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "מובילת שוק השבבים העולמית"},
              {"ticker": "AAPL", "weight": 20, "role": "עוגן ערך ויציבות", "reason": "תזרים מזומנים אדיר"}
            ]`;

            try {
                const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: "application/json" }})
                });
                const aiData = await aiRes.json();
                if (!aiData?.candidates?.length || !aiData.candidates[0]?.content?.parts?.[0]?.text) throw new Error("Gemini empty response");
                let text = aiData.candidates[0].content.parts[0].text;
                let s = text.indexOf('['); let e = text.lastIndexOf(']');
                if (s !== -1 && e !== -1) text = text.substring(s, e + 1);
                return res.status(200).json({ success: true, portfolio: JSON.parse(text) });
            } catch (e) {
                return res.status(200).json({ success: true, portfolio: [{"ticker": "NVDA", "weight": 30, "role": "מנוע צמיחה ומומנטום", "reason": "שליטה ב-AI"}, {"ticker": "MSFT", "weight": 20, "role": "עוגן ויציבות", "reason": "תזרים יציב"}]});
            }
        }

        // --- נתוני שוק ---
        if (action === 'market' || (!ticker && action !== 'analyze')) {
            const marketData = await getOrSetCache(buildCacheKey('market', 'homepage'), 45 * 1000, async () => {
                const [spy, qqq, dia, iwm, xlk, xlv, xlf, xle, xly, xli, newsData, topGainers, topLosers] = await Promise.all([
                    fetchFinnhub('quote', 'symbol=SPY'), fetchFinnhub('quote', 'symbol=QQQ'), fetchFinnhub('quote', 'symbol=DIA'), fetchFinnhub('quote', 'symbol=IWM'),
                    fetchFinnhub('quote', 'symbol=XLK'), fetchFinnhub('quote', 'symbol=XLV'), fetchFinnhub('quote', 'symbol=XLF'), fetchFinnhub('quote', 'symbol=XLE'),
                    fetchFinnhub('quote', 'symbol=XLY'), fetchFinnhub('quote', 'symbol=XLI'), fetchFinnhub('news', 'category=business'),
                    fetchYahooScreener('day_gainers'), fetchYahooScreener('day_losers')
                ]);
                return {
                    indexes: [{ symbol: 'S&P 500', price: spy?.c, changesPercentage: spy?.dp }, { symbol: 'NASDAQ', price: qqq?.c, changesPercentage: qqq?.dp }, { symbol: 'DOW 30', price: dia?.c, changesPercentage: dia?.dp }, { symbol: 'RUSSELL 2000', price: iwm?.c, changesPercentage: iwm?.dp }],
                    sectors: [{ sector: "Technology", changesPercentage: String(xlk?.dp) }, { sector: "Healthcare", changesPercentage: String(xlv?.dp) }, { sector: "Financials", changesPercentage: String(xlf?.dp) }, { sector: "Industrials", changesPercentage: String(xli?.dp) }, { sector: "Consumer Cyclical", changesPercentage: String(xly?.dp) }, { sector: "Energy", changesPercentage: String(xle?.dp) }],
                    gainers: topGainers, losers: topLosers,
                    news: (Array.isArray(newsData) ? newsData : []).slice(0, 5).map(item => ({ title: item.headline, url: item.url, source: item.source, date: new Date(item.datetime * 1000).toISOString() }))
                };
            });
            return res.status(200).json({ success: true, marketData });
        }

        if (action === 'screener') {
            const type = req.query.type || 'day_gainers';
            const data = await getOrSetCache(buildCacheKey('screener', type), 45 * 1000, async () => fetchYahooScreener(type));
            return res.status(200).json({ success: true, data });
        }

        if (action === 'watchlist_data') {
            const rawSymbols = String(req.query.symbols || "")
                .split(',')
                .map(s => s.trim().toUpperCase())
                .filter(Boolean);
            const symbols = [...new Set(rawSymbols)].slice(0, 40);
            if (symbols.length === 0) return res.status(200).json({ success: true, data: [] });

            const rows = await Promise.all(symbols.map(async (sym) => {
                const rowKey = buildCacheKey('watchlist_row', sym);
                return getOrSetCache(rowKey, 20 * 1000, async () => {
                    const [quote, chartPoints] = await Promise.all([
                        fetchYahooQuote(sym),
                        fetchYahooData(sym, '3mo', '1d')
                    ]);
                    const miniSeries = chartPoints.slice(-20).map(point => Number(point.close)).filter(Number.isFinite);
                    return {
                        ticker: sym,
                        price: Number(quote?.c || 0),
                        changePercentage: Number(quote?.dp || 0),
                        volume: Number(chartPoints[chartPoints.length - 1]?.volume || 0),
                        miniSeries
                    };
                });
            }));
            return res.status(200).json({ success: true, data: rows.filter(Boolean) });
        }

        if (action === 'symbol_search') {
            const q = String(req.query.q || "").trim().toUpperCase();
            if (!q || q.length < 1) return res.status(200).json({ success: true, data: [] });
            const fallback = [
                'AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AMD','AVGO','PLTR',
                'SPY','QQQ','DIA','IWM','SMCI','TSM','NFLX','INTC','COIN','MSTR'
            ]
                .filter((s) => s.includes(q))
                .slice(0, 10)
                .map((symbol) => ({ symbol, description: symbol }));
            const data = await getOrSetCache(buildCacheKey('symbol_search', q), 60 * 1000, async () => {
                const fromFinnhub = await fetchFinnhub('search', `q=${encodeURIComponent(q)}`);
                const list = Array.isArray(fromFinnhub?.result) ? fromFinnhub.result : [];
                if (!list.length) return fallback;
                return list
                    .filter((item) => item?.symbol && item?.type === 'Common Stock')
                    .slice(0, 10)
                    .map((item) => ({
                        symbol: String(item.symbol || '').toUpperCase(),
                        description: item.description || item.displaySymbol || item.symbol
                    }));
            });
            return res.status(200).json({ success: true, data });
        }

        if (action === 'compare') {
            const t1 = (req.query.t1 || "").toUpperCase().trim();
            const t2 = (req.query.t2 || "").toUpperCase().trim();
            if (!t1 || !t2) return res.status(200).json({ success: false, message: "Missing tickers" });
            const spyComparePointsPromise = fetchYahooData('SPY', '6mo', '1d');

            const fetchLiveSnap = async (sym) => {
                const [quote, chart] = await Promise.all([
                    fetchFinnhub('quote', `symbol=${sym}`),
                    fetchYahooData(sym, '6mo', '1d')
                ]);
                if (!quote?.c || !Array.isArray(chart) || chart.length < 30) return null;
                const spyComparePoints = await spyComparePointsPromise;
                const last = chart[chart.length - 1] || {};
                const rsi = calculateRSI(chart.map(p => p.close));
                const rel = sym === 'SPY' ? 0 : Number(calculateRelativeStrength(chart, spyComparePoints));
                const aboveMa50 = Number.isFinite(last.ma50) && quote.c >= last.ma50;
                const aboveMa200 = Number.isFinite(last.ma200) && quote.c >= last.ma200;
                return {
                    ticker: sym,
                    price: Number(quote.c).toFixed(2),
                    change: Number(quote.dp || 0).toFixed(2),
                    rsi: Number(rsi).toFixed(1),
                    ma50: last.ma50 ? Number(last.ma50).toFixed(2) : 'N/A',
                    ma200: last.ma200 ? Number(last.ma200).toFixed(2) : 'N/A',
                    trend: aboveMa50 && aboveMa200 ? 'עולה מעל שני ממוצעים' : !aboveMa50 && !aboveMa200 ? 'מתחת לשני ממוצעים' : 'מעורב',
                    relativeStrength: Number.isFinite(rel) ? rel.toFixed(2) : '0.00',
                    pattern: detectAllPatterns(chart).text || 'לא זוהתה תבנית'
                };
            };

            const [snap1, snap2] = await Promise.all([fetchLiveSnap(t1), fetchLiveSnap(t2)]);
            if (!snap1 || !snap2) return res.status(200).json({ success: false, message: "לא ניתן למשוך נתונים לאחד הסימולים." });

            const promptText = `אתה אנליסט מניות בכיר. השווה בין שתי המניות רק לפי הנתונים הבאים:
${t1}: מחיר $${snap1.price} | שינוי יומי ${snap1.change}% | RSI ${snap1.rsi} | מגמה: ${snap1.trend} | עוצמה יחסית ${snap1.relativeStrength}% | תבנית: ${snap1.pattern}
${t2}: מחיר $${snap2.price} | שינוי יומי ${snap2.change}% | RSI ${snap2.rsi} | מגמה: ${snap2.trend} | עוצמה יחסית ${snap2.relativeStrength}% | תבנית: ${snap2.pattern}
החלט מי עדיפה לטווח קצר-בינוני ללמידה ו-Paper Trading בלבד. החזר JSON בלבד:
{"winner":"TICKER","reasoning":"2-3 משפטים מבוססי נתונים למה היא עדיפה"}`;

            try {
                const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" }})
                });
                const aiData = await aiRes.json();
                const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) throw new Error("Empty response");
                const parsed = cleanJSON(text);
                return res.status(200).json({ success: true, comparison: parsed });
            } catch (e) {
                return res.status(200).json({ success: false, message: "שגיאה בניתוח ההשוואה." });
            }
        }

        if (!ticker) return res.status(200).json({ success: false, message: "Missing ticker symbol" });

        // --- Cache / Live Data ---
        if (action === 'live_data') {
            const liveData = await getOrSetCache(buildCacheKey('live_data', ticker), 20 * 1000, async () => {
                const quote = await fetchYahooQuote(ticker);
                if (!quote) return null;
                const chartPoints = await fetchYahooData(ticker, '2y', '1d');
                const lastChartPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
                const patternObj = detectAllPatterns(chartPoints);
                return {
                    success: true, ticker, price: Number(quote.c), changePercentage: Number(quote.dp),
                    ma50: lastChartPoint.ma50 || null, ma200: lastChartPoint.ma200 || null, volume: Number(lastChartPoint.volume || 0),
                    pattern: patternObj.text, patternLines: patternObj.lines, rsi: calculateRSI(chartPoints.map(p=>p.close)), chartData: chartPoints
                };
            });
            if (!liveData) return res.status(200).json({ success: false, message: "לא ניתן למשוך מחיר למניה זו" });
            return res.status(200).json(liveData);
        }

        // --- התחלת תהליך ניתוח עומק (Analyze) ---
        const [quote, chartPointsDaily, chartPointsWeekly, spyPointsDaily, vixQuote, tnxQuote] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`), fetchYahooData(ticker, '2y', '1d'), fetchYahooData(ticker, '2y', '1wk', 50, 200), fetchYahooData('SPY', '2y', '1d'), fetchYahooQuote('^VIX'), fetchYahooQuote('^TNX')
        ]);

        if (!quote || quote.c === 0 || chartPointsDaily.length < 10) return res.status(200).json({ success: false, message: `הסימול לא נמצא או אין מספיק נתונים היסטוריים.` });

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [profile, metricsData, earningsData, tickerNews, insiderData, recommendationData, priceTargetData] = await Promise.all([
            fetchFinnhub('stock/profile2', `symbol=${ticker}`), fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`), fetchFinnhub('stock/earnings', `symbol=${ticker}`), fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`), fetchFinnhub('insider-transactions', `symbol=${ticker}`), fetchFinnhub('stock/recommendation', `symbol=${ticker}`), fetchFinnhub('stock/price-target', `symbol=${ticker}`)
        ]);

        const m = metricsData?.metric || {};
        const rawMarketCap = sanitizeValue(profile?.marketCapitalization || m?.marketCapitalization);
        const fundamentals = {
            marketCap: rawMarketCap !== null ? rawMarketCap * 1000000 : null, peRatio: sanitizeValue(m?.peBasicExclExtraTTM || m?.peExclExtraAnnual), pbRatio: sanitizeValue(m?.pbAnnual || m?.pbQuarterly), psRatio: sanitizeValue(m?.psTTM || m?.psAnnual), eps: sanitizeValue(m?.epsTTM || m?.epsExclExtraItemsAnnual), epsGrowth5Y: sanitizeValue(m?.epsGrowth5Y), roe: sanitizeValue(m?.roeTTM), roa: sanitizeValue(m?.roaTTM), roic: sanitizeValue(m?.roicTTM), debtToEquity: sanitizeValue(m?.totalDebtToEquityAnnual || m?.totalDebtToEquityQuarterly), dividendYield: sanitizeValue(m?.dividendYieldIndicatedAnnual), revenueGrowth: sanitizeValue(m?.revenueGrowthTTMYoy || m?.revenueGrowth5Y), grossMargin: sanitizeValue(m?.grossMarginTTM || m?.grossMarginAnnual), operatingMargin: sanitizeValue(m?.operatingMarginTTM || m?.operatingMarginAnnual), netMargin: sanitizeValue(m?.netProfitMarginTTM || m?.netMarginTTM), currentRatio: sanitizeValue(m?.currentRatioQuarterly || m?.currentRatioAnnual), quickRatio: sanitizeValue(m?.quickRatioQuarterly || m?.quickRatioAnnual), beta: sanitizeValue(m?.beta), fiftyTwoWeekHigh: sanitizeValue(m?.['52WeekHigh']), fiftyTwoWeekLow: sanitizeValue(m?.['52WeekLow'])
        };

        const insiders = Array.isArray(insiderData?.data) ? insiderData.data : [];
        let netInsiderShares = 0; insiders.slice(0, 15).forEach(t => netInsiderShares += (t.change || 0));
        const insiderSentiment = netInsiderShares > 0 ? 'חיובי (קניות)' : netInsiderShares < 0 ? 'שלילי (מכירות)' : 'ניטרלי';

        const lastPointDaily = chartPointsDaily[chartPointsDaily.length - 1];
        const lastPointWeekly = chartPointsWeekly.length > 0 ? chartPointsWeekly[chartPointsWeekly.length - 1] : {};
        const keyLevels = extractKeyLevels(chartPointsDaily);
        const patternObj = detectAllPatterns(chartPointsDaily);
        const rsiVal = calculateRSI(chartPointsDaily.map(p=>p.close));
        const relativeStrength = calculateRelativeStrength(chartPointsDaily, spyPointsDaily);
        const currPrice = Number(quote.c);

        let earningsStreak = "אין מספיק נתונים על דוחות עבר.";
        if (Array.isArray(earningsData) && earningsData.length >= 3) {
            const recent = earningsData.slice(0,3).map(e => e.surprisePercent > 0 ? '✅' : '❌').join(' ');
            earningsStreak = `הפתעות ב-3 רבעונים אחרונים: ${recent}.`;
        }
        
        let analystConsensus = "אין נתוני אנליסטים.";
        if (Array.isArray(recommendationData) && recommendationData.length > 0) {
            const rec = recommendationData[0];
            analystConsensus = `${rec.buy + rec.strongBuy} המלצות קנייה, ${rec.hold} החזקה, ${rec.sell + rec.strongSell} מכירה.`;
        }
        if (priceTargetData?.targetMedian) analystConsensus += ` יעד חציוני: $${priceTargetData.targetMedian.toFixed(2)}.`;

        const marketContext = `אג"ח 10 שנים: ${tnxQuote?.c||'N/A'}%. VIX: ${vixQuote?.c||'N/A'}. עוצמה יחסית מול השוק בחודש האחרון: ${relativeStrength > 0 ? '+' : ''}${relativeStrength}%.`;
        const recentNews = (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 3).map(n => n.headline).join(" | ");
        const quantScorecard = buildQuantScorecard({ fundamentals, currPrice, chartPointsDaily, spyPointsDaily, rsiVal, relativeStrength, keyLevels, priceTargetData, earningsData, insiderSentiment });
        const fixedScores = JSON.stringify(quantScorecard.scores);

        const promptText = `אתה "FinShark" - אנליסט מניות בוול סטריט.
המניה: ${ticker} ($${currPrice}). מאקרו: ${marketContext}. קונצנזוס: ${analystConsensus}. חדשות: ${recentNews || 'אין'}. 
טכני(סווינג): יומי $${currPrice}, MA50=$${lastPointDaily.ma50}, MA200=$${lastPointDaily.ma200}. מומנטום: RSI=${rsiVal.toFixed(1)}, תבנית: ${patternObj.text}. פונדמנטלס: P/E=${fundamentals.peRatio || 'N/A'}, צמיחה=${fundamentals.revenueGrowth || 'N/A'}%. ${earningsStreak}.
ציון כמותי מחושב מנתוני שוק, לא לשנות: ${fixedScores}. רמות סווינג מחושבות: יעד ${formatDollar(quantScorecard.risk_levels.target)}, סטופ ${formatDollar(quantScorecard.risk_levels.stop)}.
הנחיות: 1. להסביר את הציון לפי הנתונים בלבד, 2. technical לגרף בלבד, 3. בלי המלצה אישית או הבטחת תשואה, 4. ללא מרכאות כפולות בתוך טקסטים, 5. לסימולטור Paper Trading וללמידה בלבד. החזר JSON תקין ומכווץ במבנה הבא:
{"ai_scratchpad":"מחשבות לוגיות קצרות...","confidence_score":85,"internal_logic":"משפט קצר על הדירוג","identity":"תיאור חברה קצר","technical":"ניתוח טכני טהור","long_term":{"summary":"מסקנה","intrinsic_value":"שווי הוגן","accumulation_zone":"טווח","price_target":"יעד 12M"},"short_term":{"summary":"תוכנית סווינג","entry_price":"${formatDollar(currPrice)}","target_price":"${formatDollar(quantScorecard.risk_levels.target)}","stop_loss":"${formatDollar(quantScorecard.risk_levels.stop)}"},"pros":["זכות1"],"cons":["סיכון1"],"news_sentiment_score":8,"scores":${fixedScores},"rating":"${ratingFromScore(quantScorecard.scores.overall)}"}`;

        const shouldRunClaude = shouldRunAI && aiMode === 'full' && Boolean(anthropicKey);
        const aiResponseCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
        const geminiCacheKey = buildCacheKey('ai_gemini', `${ticker}:${aiMode}`);
        const claudeCacheKey = buildCacheKey('ai_claude', `${ticker}:${aiMode}`);

        const geminiPromise = shouldRunAI ? getOrSetCacheIf(
            geminiCacheKey,
            aiResponseCacheTtlMs,
            () => fetchGeminiJson(geminiKey, promptText, aiMode === 'full' ? 0.1 : 0.05),
            (value) => Boolean(value?.parsed)
        ) : Promise.resolve(null);

        const claudePromise = shouldRunClaude ? getOrSetCacheIf(
            claudeCacheKey,
            aiResponseCacheTtlMs,
            () => fetchClaudeJson(anthropicKey, promptText),
            (value) => Boolean(value?.parsed)
        ) : Promise.resolve(null);

        const [geminiRes, claudeRes] = await Promise.all([geminiPromise, claudePromise].map(p => p.catch(e => ({ error: { message: e.message } }))));

        let geminiData = null;
        let geminiModelUsed = null;
        let geminiDebugMsg = null;
        let claudeData = null;
        let claudeModelUsed = null;
        let claudeDebugMsg = null; 

        if (geminiRes?.parsed) {
            geminiData = geminiRes.parsed;
            geminiModelUsed = geminiRes.model || null;
        } else if (shouldRunAI && geminiRes?.error) {
            geminiDebugMsg = `שגיאת Gemini: ${geminiRes.error.message || JSON.stringify(geminiRes.error)}`;
        } else if (!shouldRunAI) {
            geminiDebugMsg = "מצב חסכון API: הניתוח נשען על מנוע כמותי בלבד.";
        }
        
        if (!shouldRunAI) {
            claudeDebugMsg = "מצב חסכון API: בוצע ניתוח כמותי ללא קריאת מודלי AI.";
        } else if (!shouldRunClaude) {
            claudeDebugMsg = aiMode === 'full' ? "Claude אינו זמין כרגע, הניתוח נשען על Gemini ונתונים כמותיים." : "מצב Smart: הופעל מודל יחיד.";
        } else if (!anthropicKey) {
            claudeDebugMsg = "מפתח ANTHROPIC_API_KEY חסר ב-Vercel!";
        } else if (claudeRes && claudeRes.parsed) {
            claudeData = claudeRes.parsed;
            claudeModelUsed = claudeRes.model || null;
        } else if (claudeRes && claudeRes.error) {
            claudeDebugMsg = `שגיאת הרשאות: ${claudeRes.error.message || JSON.stringify(claudeRes.error)}`;
        } else if (!claudeRes) {
            claudeDebugMsg = "אין תשובה מהשרת של קלוד.";
        } else {
            claudeDebugMsg = "קלוד לא החזיר JSON תקין גם אחרי ניסיון תיקון.";
        }

        let finalVerdict = { isError: true, identity: "שגיאה בניתוח המניה.", technical: "לא התקבלו נתונים." };

        if (geminiData && claudeData) {
            const gScore = geminiData.scores?.overall || 50;
            const cScore = claudeData.scores?.overall || 50;
            const diff = Math.abs(gScore - cScore);
            let finalScore = Math.round((gScore + cScore) / 2);
            let finalRating = finalScore >= 80 ? "קנייה חזקה 🔥" : finalScore >= 60 ? "קנייה ✓" : finalScore <= 40 ? "מכירה ✗" : "החזקה —";
            const gLong = geminiData.long_term || {};
            const cLong = claudeData.long_term || {};
            const gShort = geminiData.short_term || {};
            const cShort = claudeData.short_term || {};
            
            let scratchpadCombined = `<span style="color:#0a84ff; font-weight:bold;">🔵 Gemini:</span> ${geminiData.ai_scratchpad}<br><br><span style="color:#e67e22; font-weight:bold;">🟠 Claude:</span> ${claudeData.ai_scratchpad}`;
            
            if (diff > 30) {
                finalScore = Math.min(finalScore, 50); 
                finalRating = "מעורב / סיכון גבוה ⚖️";
                scratchpadCombined = `<span style="color:var(--red); font-weight:800;">⚠️ מחלוקת חריפה במועצת ה-AI!</span><br><br><span style="color:#0a84ff; font-weight:bold;">🔵 Gemini (ציון ${gScore}):</span> ${geminiData.ai_scratchpad}<br><br><span style="color:#e67e22; font-weight:bold;">🟠 Claude (ציון ${cScore}):</span> ${claudeData.ai_scratchpad}`;
            }

            finalVerdict = {
                isError: false,
                ai_scratchpad: scratchpadCombined,
                internal_logic: `[Ensemble Match: ${diff <= 30 ? 'High' : 'Low'}]`,
                identity: geminiData.identity,
                technical: `<span style="color:#0a84ff; font-weight:bold;">מנוע Gemini:</span> ${geminiData.technical}<br><br><span style="color:#e67e22; font-weight:bold;">מנוע Claude:</span> ${claudeData.technical}`,
                long_term: {
                    summary: gLong.summary || cLong.summary || "אין מספיק נתונים.",
                    intrinsic_value: gLong.intrinsic_value || cLong.intrinsic_value || "N/A",
                    accumulation_zone: gLong.accumulation_zone || cLong.accumulation_zone || "N/A",
                    price_target: Math.min(Number(String(gLong.price_target).replace(/[^0-9.]/g, '')||0), Number(String(cLong.price_target).replace(/[^0-9.]/g, '')||0)) || gLong.price_target || cLong.price_target
                },
                short_term: {
                    summary: cShort.summary || gShort.summary || "אין מספיק נתונים.",
                    entry_price: currPrice,
                    target_price: gShort.target_price || cShort.target_price,
                    stop_loss: Math.max(Number(String(gShort.stop_loss).replace(/[^0-9.]/g, '')||0), Number(String(cShort.stop_loss).replace(/[^0-9.]/g, '')||0)) || gShort.stop_loss || cShort.stop_loss
                },
                pros: [...new Set([...(geminiData.pros||[]), ...(claudeData.pros||[])])].slice(0, 4),
                cons: [...new Set([...(geminiData.cons||[]), ...(claudeData.cons||[])])].slice(0, 4),
                news_sentiment_score: Math.round(((geminiData.news_sentiment_score||5) + (claudeData.news_sentiment_score||5))/2),
                scores: {
                    overall: finalScore,
                    growth: Math.round(((geminiData.scores?.growth||50) + (claudeData.scores?.growth||50))/2),
                    value: Math.round(((geminiData.scores?.value||50) + (claudeData.scores?.value||50))/2),
                    momentum: Math.round(((geminiData.scores?.momentum||50) + (claudeData.scores?.momentum||50))/2),
                    quality: Math.round(((geminiData.scores?.quality||50) + (claudeData.scores?.quality||50))/2)
                },
                confidence_score: Math.round(((geminiData.confidence_score||80) + (claudeData.confidence_score||80))/2),
                rating: finalRating
            };
        } else if (geminiData) {
            finalVerdict = { ...geminiData, isError: false, ai_scratchpad: `<span style="color:#0a84ff; font-weight:bold;">🔵 Gemini:</span> ${geminiData.ai_scratchpad}` };
        } else if (claudeData) {
            finalVerdict = { ...claudeData, isError: false, ai_scratchpad: `<span style="color:#e67e22; font-weight:bold;">🟠 Claude:</span> ${claudeData.ai_scratchpad}` };
        }

        const modelScores = [geminiData?.scores?.overall, claudeData?.scores?.overall].map(Number).filter(Number.isFinite);
        const modelDiff = modelScores.length === 2 ? Math.abs(modelScores[0] - modelScores[1]) : null;
        const modelPenalty = modelDiff !== null && modelDiff > 30 ? 18 : modelDiff !== null && modelDiff > 18 ? 8 : 0;
        const noModelPenalty = modelScores.length === 0 ? 12 : 0;
        const finalDataScore = clampNumber(quantScorecard.scores.overall - modelPenalty, 0, 100, quantScorecard.scores.overall);
        const finalConfidence = clampNumber(Math.min(quantScorecard.confidence_score, finalVerdict.confidence_score || quantScorecard.confidence_score) - modelPenalty - noModelPenalty, 25, 95, quantScorecard.confidence_score);
        const modelAgreement = modelDiff === null ? "מודל יחיד / חסר" : modelDiff <= 18 ? "גבוהה" : modelDiff <= 30 ? "בינונית" : "נמוכה";

        if (finalVerdict.isError) {
            finalVerdict = {
                isError: false,
                ai_scratchpad: "מנועי ה-AI לא החזירו JSON תקין, לכן הופעל ניתוח כמותי מבוסס נתונים בלבד.",
                internal_logic: "Fallback quantitative scorecard",
                identity: `${profile?.name || ticker}: ניתוח מבוסס נתוני מחיר, מומנטום ופונדמנטלס זמינים.`,
                technical: `${patternObj.text}. RSI ${rsiVal.toFixed(1)}, מחיר ${currPrice >= (lastPointDaily.ma50 || Infinity) ? "מעל" : "מתחת"} MA50 ו-${currPrice >= (lastPointDaily.ma200 || Infinity) ? "מעל" : "מתחת"} MA200.`,
                long_term: { summary: "הערכת הטווח הארוך מבוססת על תמחור, צמיחה, רווחיות ובריאות מאזנית.", intrinsic_value: "לא חושב DCF מלא", accumulation_zone: "קרוב לתמיכה טכנית", price_target: priceTargetData?.targetMedian ? formatDollar(priceTargetData.targetMedian) : "N/A" },
                short_term: { summary: "תוכנית הסווינג מבוססת על ATR, ממוצעים נעים ורמות תמיכה/התנגדות.", entry_price: formatDollar(currPrice), target_price: formatDollar(quantScorecard.risk_levels.target), stop_loss: formatDollar(quantScorecard.risk_levels.stop) },
                pros: quantScorecard.drivers.filter(d => d.score >= 60).map(d => `${d.label}: ${d.value}`).slice(0, 3),
                cons: quantScorecard.drivers.filter(d => d.score < 55).map(d => `${d.label}: ${d.value}`).slice(0, 3),
                news_sentiment_score: 5
            };
        }

        finalVerdict.scores = { ...quantScorecard.scores, overall: Math.round(finalDataScore) };
        finalVerdict.confidence_score = Math.round(finalConfidence);
        finalVerdict.rating = modelPenalty >= 18 ? "מעורב / סיכון גבוה" : ratingFromScore(finalDataScore);
        finalVerdict.short_term = normalizeTradePlan(finalVerdict.short_term, currPrice, quantScorecard.risk_levels);
        finalVerdict.long_term = normalizeLongTermPlan(finalVerdict.long_term, priceTargetData, currPrice, quantScorecard);
        finalVerdict.internal_logic = `${finalVerdict.internal_logic || ""} | ציון נתונים: ${Math.round(finalDataScore)}/100 | הסכמת מודלים: ${modelAgreement}${claudeModelUsed ? ` | Claude: ${claudeModelUsed}` : ""}`.trim();
        finalVerdict.scorecard = {
            data_quality: quantScorecard.data_quality,
            risk_levels: quantScorecard.risk_levels,
            drivers: quantScorecard.drivers,
            model_agreement: {
                label: modelAgreement,
                diff: modelDiff,
                gemini: geminiData?.scores?.overall ?? null,
                claude: claudeData?.scores?.overall ?? null
            }
        };
        finalVerdict.model_runtime = {
            gemini: geminiData ? "active" : "missing",
            claude: claudeData ? "active" : "missing",
            gemini_model: geminiModelUsed || null,
            gemini_note: geminiDebugMsg || null,
            claude_model: claudeModelUsed || null,
            claude_note: claudeDebugMsg || null
        };

        return res.status(200).json({
            success: true, isDataComplete: true, ticker, name: profile?.name || ticker, industry: profile?.finnhubIndustry || "N/A", sector: profile?.finnhubIndustry || "N/A",
            price: currPrice, changePercentage: Number(quote.dp),
            ma50: lastPointDaily.ma50, ma200: lastPointDaily.ma200, volume: Number(quote.v || lastPointDaily.volume || 0),
            pattern: patternObj.text, patternLines: patternObj.lines, rsi: rsiVal, keyLevels, ...fundamentals,
            latestEarnings: (Array.isArray(earningsData) && earningsData.length > 0) ? earningsData[0] : null,
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            insiderTransactions: insiders.slice(0, 6), insiderSentiment: insiderSentiment,
            analysis: finalVerdict, chartData: chartPointsDaily
        });
    } catch (error) {
        console.error("Global Catch Error:", error);
        return res.status(200).json({ success: false, message: error.message });
    }
};
