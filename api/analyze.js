async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { 
        console.error(`Finnhub Error (${endpoint}):`, e);
        return null; 
    }
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
        })).filter(p => !isNaN(p.close) && p.close !== null);

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
    } catch (e) { 
        console.error('Yahoo Finance Error:', e);
        return []; 
    }
}

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length <= period) return 50; 
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
    if (!points || points.length < 50) return [];
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
    // Extracting the closest meaningful resistance and support
    let above = levels.filter(l => l.price > currentPrice * 1.01 && l.type.includes('התנגדות')).sort((a,b) => a.price - b.price);
    let below = levels.filter(l => l.price < currentPrice * 0.99 && l.type.includes('תמיכה')).sort((a,b) => b.price - a.price);
    
    let finalLevels = [];
    if (above.length > 0) finalLevels.push(above[0]);
    if (below.length > 0) finalLevels.push(below[0]);
    
    return finalLevels;
}

function detectAllPatterns(chartPoints) {
    if (!chartPoints || chartPoints.length < 50) return { text: "אין מספיק נתונים", lines: [] };
    let patterns = [];
    const curr = chartPoints[chartPoints.length - 1];
    const prev = chartPoints[chartPoints.length - 2];
    
    // Golden Cross / Death Cross Detection
    if (curr.ma50 && curr.ma200 && prev.ma50 && prev.ma200) {
        if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) patterns.push("Golden Cross 📈");
        if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) patterns.push("Death Cross 📉");
    }
    
    const text = patterns.length === 0 ? "Neutral / No clear MA pattern" : [...new Set(patterns)].join(" | ");
    return { text, lines: [] };
}

module.exports = async function(req, res) {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || "").toUpperCase().trim();
        const action = req.query.action;
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!ticker) {
            return res.status(400).json({ success: false, message: "Missing ticker symbol" });
        }

        // Live Data fetch for Virtual Portfolio Updates
        if (action === 'live_data') {
            const quote = await fetchFinnhub('quote', `symbol=${ticker}`);
            return res.status(200).json({ success: true, price: Number(quote?.c || 0) });
        }

        const today = new Date().toISOString().split('T')[0];
        const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Fetching all necessary data in parallel
        const [quote, profile, chartPoints, metricsData, tickerNews, earningsData] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchYahooData(ticker, '2y', '1d'), 
            fetchFinnhub('stock/metric', `symbol=${ticker}&metric=all`),
            fetchFinnhub('company-news', `symbol=${ticker}&from=${lastMonth}&to=${today}`),
            fetchFinnhub('stock/earnings', `symbol=${ticker}`) 
        ]);

        const m = metricsData?.metric || {};
        const currPrice = Number(quote?.c || 0);
        const lastPoint = chartPoints && chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : {};
        
        // Failsafe for empty chart data
        let rsi = 50, keyLevels = [], levelsPrompt = 'No immediate levels nearby', patternObj = { text: "No Data", lines: [] };
        if (chartPoints && chartPoints.length > 0) {
            rsi = calculateRSI(chartPoints.map(p => p.close));
            keyLevels = extractKeyLevels(chartPoints);
            levelsPrompt = keyLevels.map(l => `${l.type}: $${l.price.toFixed(2)}`).join(', ');
            patternObj = detectAllPatterns(chartPoints);
        }
        
        const recentNews = (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 3).map(n => n.headline).join(" | ");
        
        let latestEarningStr = "No recent earnings data";
        if (Array.isArray(earningsData) && earningsData.length > 0 && earningsData[0].surprisePercent !== null) {
            const latest = earningsData[0];
            latestEarningStr = `Latest Earning Surprise: ${latest.surprisePercent}% vs estimates.`;
        }

        // --- THE "WALL STREET ELITE" PROMPT ---
        // English instructions for max IQ reasoning, Hebrew output for local display.
        const prompt = `You are "FinShark", an elite algorithmic and fundamental trading AI designed to outperform top Wall Street analysts. 
        You combine the value investing logic of Warren Buffett with the precise technical swing trading execution of Paul Tudor Jones.
        
        Analyze the following data for ${ticker} (${profile?.name || ticker}). Current Price: $${currPrice}.
        
        [TECHNICAL DATA]
        - RSI (14): ${rsi.toFixed(2)} (Above 70=Overbought, Below 30=Oversold)
        - 50-day MA: $${lastPoint.ma50 || 'N/A'}, 200-day MA: $${lastPoint.ma200 || 'N/A'}
        - Detected Pattern: ${patternObj.text}
        - Algorithmic Key Levels: ${levelsPrompt}
        
        [FUNDAMENTAL DATA]
        - Industry: ${profile?.finnhubIndustry || 'N/A'}
        - P/E Ratio: ${m.peBasicExclExtraTTM || 'N/A'}
        - 52-Week High/Low: $${m['52WeekHigh'] || 'N/A'} / $${m['52WeekLow'] || 'N/A'}
        - Earnings: ${latestEarningStr}
        - Recent News: ${recentNews || 'None'}
        
        YOUR DIRECTIVES (BE BRUTALLY HONEST):
        1. SHORT-TERM (Swing Trade - 1 to 4 weeks):
           - Evaluate momentum based on RSI and Moving Averages.
           - TARGET: Must be the closest Resistance level provided. If none, project a logical target based on recent highs.
           - STOP LOSS: Must be the closest Support level provided OR exactly -3% from entry. 
           - Rule: Do NOT recommend a "Buy" if Stop Loss distance is larger than Target distance (Bad Risk/Reward).
        
        2. LONG-TERM (Value Investing - 1 to 3 years):
           - Evaluate P/E, industry standing, and earnings surprise. Is the company fundamentally strong or overvalued?
           - INTRINSIC VALUE: Estimate a fair price.
           - ACCUMULATION ZONE: Define a price range ($XX - $XX) where it's safe to buy.
        
        3. OVERALL RATING: Choose ONE: "קנייה חזקה" (Strong Buy), "קנייה" (Buy), "המתנה" (Hold), or "מכירה" (Sell). 
        
        OUTPUT FORMAT: 
        You MUST return ONLY a valid JSON object. 
        Write detailed, insightful paragraphs (3-4 sentences) for the "summary" fields.
        ALL text values MUST be in professional, flawless Hebrew (except numbers/tickers). 
        DO NOT wrap the output in markdown blocks like \`\`\`json. Return RAW JSON only.
        
        {
          "identity": "תיאור קצר ומדויק של החברה (עד 2 משפטים)",
          "news_sentiment": "חיובי / שלילי / ניטרלי",
          "long_term": {
            "summary": "ניתוח עומק פונדמנטלי למשקיעי טווח ארוך. סכם את הנתונים הכספיים, המכפיל והפוטנציאל העתידי בצורה מקצועית (כ-3 משפטים).",
            "intrinsic_value": "$XX.XX",
            "accumulation_zone": "$XX - $XX"
          },
          "short_term": {
            "summary": "ניתוח טכני וסווינג לטווח קצר (ימים עד שבועות). התייחס למומנטום, RSI, תבניות ויחס סיכוי/סיכון (כ-3 משפטים).",
            "entry_price": "$XX.XX",
            "target_price": "$XX.XX",
            "stop_loss": "$XX.XX"
          },
          "scores": {
            "overall": 80,
            "growth": 85,
            "value": 70,
            "momentum": 90,
            "quality": 88
          },
          "rating": "קנייה חזקה"
        }`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }], 
                generationConfig: { temperature: 0.1 } // Very low temperature for analytical precision
            })
        });

        // Fallback default response in case AI fails
        let aiVerdict = {
            identity: "חברה ציבורית הנסחרת בבורסה.", 
            news_sentiment: "ניטרלי",
            long_term: { summary: "לא ניתן היה להפיק ניתוח ארוך טווח עקב חוסר בנתונים.", intrinsic_value: "N/A", accumulation_zone: "N/A" },
            short_term: { summary: "לא ניתן היה להפיק ניתוח טכני. יש להמתין להתבהרות השוק.", entry_price: "N/A", target_price: "N/A", stop_loss: "N/A" },
            scores: { overall: 50, growth: 50, value: 50, momentum: 50, quality: 50 },
            rating: "המתנה"
        };

        if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            try {
                let text = aiData.candidates[0].content.parts[0].text;
                // Advanced JSON cleaning to prevent parsing crashes
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                const startIndex = text.indexOf('{');
                const endIndex = text.lastIndexOf('}');
                
                if (startIndex !== -1 && endIndex !== -1) {
                    aiVerdict = JSON.parse(text.substring(startIndex, endIndex + 1));
                }
            } catch (e) {
                console.error('JSON Parsing Error:', e);
            }
        } else {
            console.error('AI API Error:', await aiResponse.text());
        }

        // Return the comprehensive object that the frontend expects
        return res.status(200).json({
            success: true, 
            isDataComplete: chartPoints.length > 0,
            ticker, 
            name: profile?.name || ticker, 
            industry: profile?.finnhubIndustry || "N/A",
            sector: profile?.finnhubIndustry || "N/A",
            price: currPrice, 
            changePercentage: Number(quote?.dp || 0),
            ma50: lastPoint.ma50 || null,
            ma200: lastPoint.ma200 || null,
            volume: Number(quote?.v || lastPoint.volume || 0),
            pattern: patternObj.text, 
            patternLines: patternObj.lines, 
            rsi: rsi, 
            keyLevels, 
            tickerNews: (Array.isArray(tickerNews) ? tickerNews : []).slice(0, 5),
            analysis: aiVerdict, 
            chartData: chartPoints
        });
        
    } catch (error) { 
        console.error('Global API Error:', error);
        return res.status(500).json({ success: false, message: "שגיאת שרת. אנא נסה שוב." }); 
    }
};
