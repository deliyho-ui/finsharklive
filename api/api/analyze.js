const { GoogleGenerativeAI } = require("@google/generative-ai");

async function safeFetch(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data)) return data[0] || null;
        return data;
    } catch (e) { return null; }
}

exports.handler = async function(event, context) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const STOCK_API_KEY = process.env.STOCK_API_KEY || "JGiawifxpFOz69LU6CAcwSfLijnpS3mB";
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const ticker = event.queryStringParameters.ticker?.toUpperCase();
    const action = event.queryStringParameters.action;

    try {
        // --- נתוני שוק בסיסיים (ללא Legacy) ---
        if (action === 'market') {
            const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/SPY,QQQ,DIA,VIX,BTCUSD?apikey=${STOCK_API_KEY}`);
            const data = await res.json();
            return {
                statusCode: 200, headers,
                body: JSON.stringify({ success: true, marketData: { indexes: data, sectors: [], news: [] } })
            };
        }

        if (!ticker) return { statusCode: 400, headers, body: 'Missing ticker' };

        // משיכת נתונים רק מכתובות מודרניות שאינן Legacy
        const [quote, profile, history] = await Promise.all([
            safeFetch(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${STOCK_API_KEY}`),
            safeFetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${STOCK_API_KEY}`),
            fetch(`https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=30&apikey=${STOCK_API_KEY}`).then(res => res.json())
        ]);

        if (!quote) throw new Error("מניה לא נמצאה");

        const stockData = {
            ticker: ticker,
            name: quote.name || ticker,
            price: quote.price || 0,
            changePercentage: quote.changesPercentage || 0,
            pe: quote.pe || 0,
            eps: quote.eps || 0,
            marketCap: quote.marketCap || 0,
            ma50: quote.priceAvg50 || 0,
            ma200: quote.priceAvg200 || 0,
            yearLow: quote.yearLow || 0,
            yearHigh: quote.yearHigh || 0,
            description: profile?.description || ""
        };

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
        
        const prompt = `נתח את המניה ${ticker}. מחיר: ${stockData.price}. החזר JSON בעברית: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores (overall).`;
        const aiResponse = await model.generateContent(prompt);
        
        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                success: true,
                marketData: stockData,
                chartHistory: (history.historical || []).map(h => ({ date: h.date, close: h.close })).reverse(),
                aiVerdict: JSON.parse(aiResponse.response.text())
            })
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};
