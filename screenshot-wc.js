const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  const FAKE_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  await page.addInitScript((addr) => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: addr,
      chainId: '0x4CEF52',
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
        if (method === 'eth_chainId' || method === 'net_version') return '0x4CEF52';
        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'wallet_addEthereumChain') return null;
        const res = await fetch('https://rpc.testnet.arc.network', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
      },
      on: () => {},
      removeListener: () => {}
    };
  }, FAKE_ADDR);

  await page.goto('https://arc-predict-phi.vercel.app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Click whatever connect button exists
  const btn = page.locator('button').filter({ hasText: /MetaMask|Bağla|Connect/i }).first();
  await btn.click().catch(() => {});
  await page.waitForTimeout(4000);

  // Switch to Maclar tab
  await page.locator('.tab-btn').filter({ hasText: /Maçlar|Matches/i }).first().click();
  await page.waitForTimeout(6000);

  await page.screenshot({ path: 'wc-resolved-check.png', fullPage: false });
  console.log('Screenshot saved: wc-resolved-check.png');
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
