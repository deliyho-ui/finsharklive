const yahooFinance = require('yahoo-finance2').default;
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const action = event.queryStringParameters.action;
    const ticker = event.queryStringParameters.ticker?.toUpperCase();

    try {
        // --- 1. נתוני שוק כלליים ---
        if (action === 'market') {
            const symbols = ['^GSPC', '^IXIC', '^DJI', '^VIX', 'BTC-USD'];
            const results = await Promise.all(symbols.map(s => yahooFinance.quote(s)));
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    success: true,
                    marketData: {
                        indexes: results.map(r => ({
                            symbol: r.symbol,
                            price: r.regularMarketPrice,
                            changesPercentage: r.regularMarketChangePercent
                        })),
                        sectors: [], // יאהו לא נותן סקטורים גלובליים בקלות, נשאיר ריק כרגע
                        news: [] 
                    }
                })
            };
        }

        // --- 2. ניתוח מניה עמוק ---
        if (!ticker) return { statusCode: 400, headers, body: 'Missing ticker' };

        // משיכת נתונים מיאהו פיננס
        const [quote, summary, history] = await Promise.all([
            yahooFinance.quote(ticker),
            yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail", "price", "defaultKeyStatistics"] }),
            yahooFinance.historical(ticker, { period1: '2023-01-01' })
        ]);

        const stockData = {
            ticker: ticker,
            name: quote.shortName || ticker,
            price: quote.regularMarketPrice,
            changePercentage: quote.regularMarketChangePercent,
            pe: quote.trailingPE || 0,
            eps: quote.trailingEps || 0,
            marketCap: quote.marketCap || 0,
            ma50: quote.fiftyDayAverage || 0,
            ma200: quote.twoHundredDayAverage || 0,
            yearLow: quote.fiftyTwoWeekLow || 0,
            yearHigh: quote.fiftyTwoWeekHigh || 0,
            pbRatio: summary.defaultKeyStatistics?.priceToBook || 0,
            roe: (summary.defaultKeyStatistics?.returnOnEquity || 0) * 100,
            debtToEquity: summary.summaryDetail?.debtToEquity || 0
        };

        // ניתוח AI עם Gemini
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        
        const prompt = `נתח את המניה ${ticker}. מחיר: ${stockData.price}, מכפיל רווח: ${stockData.pe}. החזר JSON עם: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores (growth, value, momentum, quality, overall). הכל בעברית.`;
        
        const aiResponse = await model.generateContent(prompt);
        const analysisResult = JSON.parse(aiResponse.response.text());

        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                success: true,
                marketData: stockData,
                chartHistory: history.map(h => ({ date: h.date, close: h.adjClose || h.close })),
                aiVerdict: analysisResult
            })
        };

    } catch (error) {
        console.error(error);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
    }
};
