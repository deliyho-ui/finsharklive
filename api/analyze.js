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

module.exports = async function(req, res) {
    // הגדרות גישה מיוחדות ל-Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // טיפול בבקשות מקדימות של הדפדפן
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const STOCK_API_KEY = process.env.STOCK_API_KEY || "JGiawifxpFOz69LU6CAcwSfLijnpS3mB";
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    // ב-Vercel, ככה מושכים את שם המניה!
    const ticker = req.query.ticker?.toUpperCase();
    const action = req.query.action;

    try {
        if (action === 'market') {
            const spyRes = await fetch(`https://financialmodelingprep.com/api/v3/quote/SPY,QQQ,DIA,VIX,BTCUSD?apikey=${STOCK_API_KEY}`);
            const data = await spyRes.json();
            return res.status(200).json({ success: true, marketData: { indexes: data, sectors: [], news: [] } });
        }

        if (!ticker) {
            return res.status(400).send('Missing ticker');
        }

        const [quote, profile, history] = await Promise.all([
            safeFetch(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${STOCK_API_KEY}`),
            safeFetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${STOCK_API_KEY}`),
            fetch(`https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=30&apikey=${STOCK_API_KEY}`).then(r => r.json())
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
        
        return res.status(200).json({
            success: true,
            marketData: stockData,
            chartHistory: (history.historical || []).map(h => ({ date: h.date, close: h.close })).reverse(),
            aiVerdict: JSON.parse(aiResponse.response.text())
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
