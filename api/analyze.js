const { GoogleGenerativeAI } = require("@google/generative-ai");

async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const ticker = req.query.ticker?.toUpperCase();
    const action = req.query.action;

    try {
        if (action === 'market') {
            const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
            const quotes = await Promise.all(symbols.map(s => fetchFinnhub('quote', `symbol=${s}`)));
            return res.status(200).json({
                success: true,
                marketData: {
                    indexes: symbols.map((s, i) => ({
                        symbol: s, price: quotes[i]?.c || 0, changesPercentage: quotes[i]?.dp || 0
                    })),
                    sectors: [], news: [] 
                }
            });
        }

        if (!ticker) return res.status(400).send('Missing ticker');

        const to = Math.floor(Date.now() / 1000);
        const from = to - (30 * 24 * 60 * 60);

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${from}&to=${to}`)
        ]);

        if (!quote || !quote.c) throw new Error("מניה לא נמצאה");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // השם הכי סטנדרטי שיש
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `נתח את ${ticker}. מחיר: ${quote.c}$. החזר JSON בעברית: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores.`;
        const aiResponse = await model.generateContent(prompt);
        
        return res.status(200).json({
            success: true,
            marketData: { ticker, name: profile?.name || ticker, price: quote.c, changePercentage: quote.dp },
            chartHistory: (candles?.c || []).map((c, i) => ({ date: new Date(candles.t[i] * 1000).toISOString().split('T')[0], close: c })),
            aiVerdict: JSON.parse(aiResponse.response.text().replace(/```json|```/g, ""))
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
