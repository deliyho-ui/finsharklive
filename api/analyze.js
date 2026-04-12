async function fetchFinnhub(endpoint, params = "") {
    const token = process.env.FINNHUB_API_KEY;
    const url = `https://finnhub.io/api/v1/${endpoint}?${params}&token=${token}`;
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const ticker = (req.query.ticker || req.query.symbol || "AAPL").toUpperCase().trim();
        const apiKey = process.env.GEMINI_API_KEY;

        const [quote, profile, candles] = await Promise.all([
            fetchFinnhub('quote', `symbol=${ticker}`),
            fetchFinnhub('stock/profile2', `symbol=${ticker}`),
            fetchFinnhub('stock/candle', `symbol=${ticker}&resolution=D&from=${Math.floor(Date.now()/1000)-2592000}&to=${Math.floor(Date.now()/1000)}`)
        ]);

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `אתה אנליסט מניות. נתח את ${ticker}. מחיר: ${quote?.c}$. החזר JSON בעברית עם המפתחות: identity, technical, news_analysis, verdict, price_target, rating, scores.`;

        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const aiData = await aiResponse.json();
        let aiVerdict = {};
        
        try {
            const text = aiData.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
            aiVerdict = JSON.parse(text);
        } catch (e) {
            console.error("AI Parse Error");
        }

        // --- כאן אנחנו מתאימים את השמות למה שהאתר מחפש ---
        return res.status(200).json({
            success: true,
            // האתר מצפה ל-name כמחרוזת (String)
            name: profile?.name || ticker, 
            ticker: ticker,
            price: quote?.c || 0,
            change: quote?.dp || 0,
            // האתר מצפה ל-verdict ככה
            verdict: aiVerdict, 
            // וגם ל-aiVerdict ליתר ביטחון
            aiVerdict: aiVerdict,
            chartData: (candles?.c || []).map((p, i) => ({
                date: new Date(candles.t[i] * 1000).toLocaleDateString(),
                value: p
            }))
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
