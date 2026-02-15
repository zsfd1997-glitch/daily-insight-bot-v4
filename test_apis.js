const axios = require('axios');

async function testAPIs() {
    // 1. Hacker News (YC)
    try {
        console.log('Testing HN...');
        const top = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
        const firstId = top.data[0];
        const item = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${firstId}.json`);
        console.log('✅ HN Success:', item.data.title);
    } catch (e) { console.log('❌ HN Failed:', e.message); }

    // 2. Bilibili Tech Ranking
    try {
        console.log('Testing Bilibili...');
        // RID 188 is Tech
        const res = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2?rid=188');
        const title = res.data.data.list[0].title;
        console.log('✅ Bilibili Success:', title);
    } catch (e) { console.log('❌ Bilibili Failed:', e.message); }

    // 3. WallstreetCN (Finance alternative) - Cailianshe is already there, but ensuring robust finance
    try {
        console.log('Testing WallstreetCN...');
        // https://api-one.wallstreetcn.com/apiv1/content/information-flow?channel=global-ticket&limit=5
        const res = await axios.get('https://api-one.wallstreetcn.com/apiv1/content/information-flow?channel=global-ticket&limit=1');
        console.log('✅ WSCN Success:', res.data.data.items[0].resource.title);
    } catch (e) { console.log('❌ WSCN Failed:', e.message); }
}

testAPIs();
