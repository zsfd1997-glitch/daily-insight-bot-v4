const { translate } = require('google-translate-api-x');

async function test() {
    try {
        console.log('Testing translation...');
        const res = await translate('Hello world', { to: 'zh-CN' });
        console.log('Result:', res.text);
    } catch (e) {
        console.error('Translation failed:', e);
    }
}

test();
