// 🦈 FinShark Netlify Serverless Function (Bulletproof Free-Tier Version)
// קובץ זה פועל בשרתים של Netlify ומקשר בין האפליקציה, נתוני הבורסה ומודל ה-AI

const { GoogleGenerativeAI } = require("@google/generative-ai");

// פונקציית עזר קריטית: מוודאת שהתשובה מ-FMP היא תמיד מערך, ולא קורסת אם חזר אובייקט שגיאה של "חריגה מהמכסה"
async function safeFetchArray(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        
        // מזהה אובייקט שגיאה של FMP ועוצר לפני קריסה
        if (data && !Array.isArray(data) && data["Error Message"]) {
            console.warn("FMP API Error/Limit:", data["Error Message"]);
            return [];
        }
        
        if (!Array.isArray(data)) return data ? [data] : [];
        return data;
    } catch (e) {
        console.error("Fetch failed:", e);
        return [];
    }
}

// פונקציה רגילה לאובייקטים
async function safeFetchObject(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data["Error Message"]) return null;
        return data;
    } catch (e) {
        return null;
    }
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') { return { statusCode: 200, headers, body: '' }; }
    if (event.httpMethod !== 'GET') { return { statusCode: 405, headers, body: 'Method Not Allowed' }; }

    const STOCK_API_KEY = process.env.STOCK_API_KEY || "JGiawifxpFOz69LU6CAcwSfLijnpS3mB";
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "🚨 חסר מפתח GEMINI_API_KEY ב-Netlify!" }) };
    }

    const action = event.queryStringParameters.action;

    // ==========================================
    // 1. קריאת נתוני שוק כלליים (Market Weather)
    // ==========================================
    if (action === 'market') {
        try {
            console.log("[Market] Fetching real market data...");
            
            // שימוש בקרנות חינמיות (SPY, QQQ) במקום המדדים הרשמיים שחסומים במסלול החינמי
            // VIX נוסף לחישוב מדד פחד/חמדנות אמיתי
            const indicesData = await safeFetchArray(`https://financialmodelingprep.com/api/v3/quote/SPY,QQQ,DIA,VIX,BTCUSD?apikey=${STOCK_API_KEY}`);
            const sectorsData = await safeFetchArray(`https://financialmodelingprep.com/api/v3/sectors-performance?apikey=${STOCK_API_KEY}`);
            let newsData = await safeFetchObject(`https://financialmodelingprep.com/api/v3/fmp/articles?page=0&size=6&apikey=${STOCK_API_KEY}`);

            // מבטיח שחדשות יחזרו כמערך גם אם FMP משנה פורמט
            if (newsData && newsData.content) {
                newsData = newsData.content;
            } else if (!Array.isArray(newsData)) {
                newsData = [];
            }

            // הופך את הקרנות החינמיות בחזרה לסימולי המדדים כדי שהממשק יזהה אותם ויציג "S&P 500"
            const formattedIndices = indicesData.map(idx => {
                if(idx.symbol === 'SPY') idx.symbol = '^GSPC';
                if(idx.symbol === 'QQQ') idx.symbol = '^IXIC';
                if(idx.symbol === 'DIA') idx.symbol = '^DJI';
                if(idx.symbol === 'VIX') idx.symbol = '^VIX';
                return idx;
            });

            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    success: true,
                    marketData: {
                        indexes: formattedIndices,
                        sectors: sectorsData,
                        news: newsData
                    }
                })
            };
        } catch (error) {
            console.error("Market Data Error:", error);
            return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "שגיאה בשרת מול FMP" }) };
        }
    }

    // ==========================================
    // 2. ניתוח מנייתי עמוק (Stock Analysis)
    // ==========================================
    const ticker = event.queryStringParameters.ticker?.toUpperCase();
    if (!ticker) { return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "לא סופק סימול מניה" }) }; }

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        console.log(`[Analyze] Fetching REAL depth data for ${ticker}...`);
        
        const [quoteData, profileData, historyData, metricsData, stockNews] = await Promise.all([
            safeFetchArray(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${STOCK_API_KEY}`),
            safeFetchArray(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${STOCK_API_KEY}`),
            safeFetchObject(`https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=253&apikey=${STOCK_API_KEY}`),
            safeFetchArray(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${STOCK_API_KEY}`),
            safeFetchArray(`https://financialmodelingprep.com/api/v3/stock_news?tickers=${ticker}&limit=3&apikey=${STOCK_API_KEY}`)
        ]);

        if (!quoteData || quoteData.length === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "מניה לא נמצאה או שחרגת ממגבלת ה-FMP החינמית" }) };
        }

        const stockInfo = quoteData[0];
        const profile = (profileData && profileData[0]) ? profileData[0] : {};
        const ttmMetrics = (metricsData && metricsData[0]) ? metricsData[0] : {};
        
        let chartHistory = [];
        if (historyData && historyData.historical) {
            chartHistory = historyData.historical.reverse().map(day => ({ date: day.date, close: day.close }));
        }

        const stockData = {
            ticker: ticker,
            name: stockInfo.name,
            price: stockInfo.price || 0,
            changePercentage: stockInfo.changesPercentage || 0,
            pe: stockInfo.pe || 0,
            eps: stockInfo.eps || 0,
            marketCap: stockInfo.marketCap || 0,
            ma50: stockInfo.priceAvg50 || 0,
            ma200: stockInfo.priceAvg200 || 0,
            volume: stockInfo.volume || 0,
            yearLow: stockInfo.yearLow || 0,
            yearHigh: stockInfo.yearHigh || 0,
            dividendYield: ttmMetrics.dividendYieldTTM ? ttmMetrics.dividendYieldTTM * 100 : 0,
            pbRatio: ttmMetrics.pbRatioTTM || 0,
            roe: ttmMetrics.roeTTM ? ttmMetrics.roeTTM * 100 : 0,
            debtToEquity: ttmMetrics.debtToEquityTTM || 0,
            industry: profile.industry || "כללי",
            sector: profile.sector || "כללי",
            description: profile.description || ""
        };

        const safeNews = Array.isArray(stockNews) ? stockNews : [];
        const newsHeadlines = safeNews.map(n => n.title).join(" | ");

        console.log(`[Analyze] Analyzing with Gemini AI...`);
        
        const prompt = `
            אתה 'כריש פיננסי', אנליסט וול-סטריט קר.
            המטרה: ניתוח המניה ${ticker} (${stockData.name}).
            
            נתונים:
            Price: $${stockData.price}, PE: ${stockData.pe}, EPS: $${stockData.eps}, P/B: ${stockData.pbRatio}, ROE: ${stockData.roe}%,
            Debt/Eq: ${stockData.debtToEquity}, 52w Range: $${stockData.yearLow}-$${stockData.yearHigh}.
            MA50: $${stockData.ma50}, MA200: $${stockData.ma200}.

            חדשות אחרונות:
            ${newsHeadlines ? newsHeadlines : "אין חדשות עדכניות."}
            
            החזר אובייקט JSON תקני בלבד במבנה הבא:
            {
                "identity": "תיאור קצר ומדויק של החברה (משפט בעברית)",
                "technical": "ניתוח טכני קצר (בעברית)",
                "news_analysis": "השפעת החדשות האחרונות (בעברית)",
                "verdict": {
                    "pros": "2 נקודות חוזק (בולטים בעברית)",
                    "cons": "2 סיכונים (בולטים בעברית)",
                    "summary": "השורה התחתונה כאנליסט (בעברית)"
                },
                "price_target": "מספר יעד ב-12 חודשים",
                "rating": "STRONG BUY, BUY, HOLD, או SELL",
                "scores": { "growth": 0-100, "value": 0-100, "momentum": 0-100, "quality": 0-100, "overall": 0-100 }
            }
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const aiResponse = await model.generateContent(prompt);
        let rawText = aiResponse.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const analysisResult = JSON.parse(rawText);

        return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, marketData: stockData, chartHistory: chartHistory, news: safeNews, aiVerdict: analysisResult })
        };

    } catch (error) {
        console.error("Server Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "שגיאת שרת או AI", error: error.message }) };
    }
};
