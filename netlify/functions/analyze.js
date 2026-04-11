const yahooFinance = require('yahoo-finance2').default;
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
    // ... שאר הקוד ששלחתי לך קודם נשאר בדיוק אותו דבר ...
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
                        sectors: [], 
                        news: [] 
                    }
                })
            };
        }

        if (!ticker) return { statusCode: 400, headers, body: 'Missing ticker' };

        const [quote, summary, history] = await Promise.all([
            yahooFinance.quote(ticker),
            yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail", "price", "defaultKeyStatistics"] }),
            yahooFinance.historical(ticker, { period1: '2024-01-01' })
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

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
        
        const prompt = `אתה אנליסט מניות. נתח את המניה ${ticker}. נתונים: מחיר ${stockData.price}, מכפיל רווח ${stockData.pe}. החזר JSON בעברית עם: identity, technical, news_analysis, verdict (pros, cons, summary), price_target, rating, scores (growth, value, momentum, quality, overall).`;
        
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
