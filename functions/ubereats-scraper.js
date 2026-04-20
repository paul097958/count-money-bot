import puppeteer from 'puppeteer';
import Fuse from 'fuse.js';
import { logger } from 'firebase-functions';

export default async function ubereatsScraper(sid, url, inputs = []) {
    logger.log('launch browser')
    const browser = await puppeteer.launch({
        headless: true,
        timeout: 0,
        slowMo: 0,
        args: [
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-sandbox',
            '--no-zygote',
            '--window-size=1280,720',
        ],
    });
    logger.log('launch browser completed')
    const page = await browser.newPage();

    const cookies = [{
        name: 'sid',
        value: sid,
        domain: '.ubereats.com',
        path: '/',
        httpOnly: true,
        secure: true
    }];

    await page.setCookie(...cookies);
    await page.goto(url, {
        timeout: 60000,
        waitUntil: 'domcontentloaded'
    });

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function getRichText() {
        const texts = await page.$$eval(
            '[data-testid="rich-text"]',
            (elements) => elements.map(el => el.innerText)
        );
        console.log(texts);
        return texts;
    }

    async function getLabelOptions() {
        // 1. 等待至少一個目標標籤出現，確保頁面已加載
        await page.waitForSelector('[data-testid="customization-option-label"]', { timeout: 120000 });

        // 2. 使用 $$eval 一次性抓取並轉換
        const texts = await page.$$eval('[data-testid="customization-option-label"]', (labels) => {
            // 這段代碼是在「瀏覽器內部」執行的
            return labels.map(label => {
                // 使用 :scope 確保從當前 label 開始往內算四層
                const fourthChild = label.querySelector(':scope > * > * > * > *');

                // 抓取文字並修剪，若找不到則回傳空字串
                return fourthChild ? fourthChild.innerText.trim() : "";
            });
        });

        // 3. 在 Node.js 端印出結果
        console.log("提取到的第四層文字陣列：", texts);
        return texts;
    }


    async function clickStoreItem(targetText) {
        const elementHandle = await page.evaluateHandle((text) => {
            const nodes = document.querySelectorAll('[data-testid="rich-text"]');
            return Array.from(nodes).find(el => el.innerText.trim() === text);
        }, targetText);
        if (elementHandle.asElement()) {
            await elementHandle.click();
            console.log(`已點擊：${targetText}`);
            await sleep(2000);
        } else {
            console.error('找不到該文字的元素');
        }
    }

    async function getPickOneItem(targetText, isLast, completedElements) {
        const success = await page.evaluate(async (target, isLastBrowser, completedElements) => {
            // 定義瀏覽器內的 sleep 函式
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            const groups = document.querySelectorAll('[data-testid="customization-pick-one"]');

            if (groups.length === 0) {
                return {
                    status: false,
                    text: "pick-one 完全找不到任何 [data-testid='customization-pick-one']"
                }
            }

            for (let i = 0; i <= groups.length - 1; i++) {
                const group = groups[i]
                // 直接在 group 裡面找 labels，不要用 page.$$eval
                const labels = Array.from(group.querySelectorAll('[data-testid="customization-option-label"]'));
                let completedElementsStatus = completedElements.includes(i);
                const targetElement = labels.find(label => {
                    const textNode = label.querySelector(':scope > * > * > * > *');
                    const text = textNode ? textNode.innerText.trim() : "";
                    return text === target
                });
                if (completedElementsStatus) continue
                if (targetElement) {
                    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    targetElement.click();
                    await sleep(500); // 點擊後的緩衝
                    return {
                        status: true,
                        text: `pick-one 找到 "${target}"，並按下`,
                        element: i
                    }
                } else if (isLastBrowser) {
                    // 2. 保底邏輯：找不到匹配文字，點擊該 group 的第一個選項
                    const firstLabel = labels[0];
                    const firstTarget = firstLabel.querySelector(':scope > * > * > * > *');

                    // 即使沒匹配文字，我們還是點擊第一個 label
                    firstLabel.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    firstLabel.click();

                    await sleep(500);
                    const fallbackText = firstTarget ? firstTarget.innerText.trim() : "未知文字";
                    return {
                        status: false,
                        text: `pick-one 找不到 "${target}"，已保底點擊第一個選項: ${fallbackText}`
                    }
                }
            }
            return {
                status: false,
                text: `在所有區塊中都找不到文字為 "${target}" 的選項`
            }
        }, targetText, isLast, completedElements);

        console.log(success);
        return success
    }


    async function getPickManyItem(targetText) {
        console.log('target text:', targetText);
        const success = await page.evaluate(async (target) => {
            // 定義瀏覽器內的 sleep 函式
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            const groups = document.querySelectorAll('[data-testid="customization-pick-many"]');

            if (groups.length === 0) {
                return "pick-many 完全找不到任何 [data-testid='customization-pick-many']";
            }

            for (const group of groups) {
                // 直接在 group 裡面找 labels，不要用 page.$$eval
                const labels = Array.from(group.querySelectorAll('[data-testid="customization-option-label"]'));

                const targetElement = labels.find(label => {
                    const fourthChild = label.querySelector(':scope > * > * > * > *');
                    return fourthChild && fourthChild.innerText.trim() === target;
                });

                console.log('target element', targetElement);
                console.log('label', labels)
                if (targetElement) {
                    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    targetElement.click();
                    await sleep(500); // 點擊後的緩衝
                    return `pick-many 已成功點擊: ${target}`;
                }
            }

            return `在所有區塊中都找不到文字為 "${target}" 的選項`;
        }, targetText);

        console.log(success);
    }


    async function clickCloseButton() {
        try {
            // 設定 timeout 為 10000 毫秒 (10秒)
            const closeButton = await page.waitForSelector('aria/Close', { timeout: 30000 });

            // 如果找到了，執行點擊
            await closeButton.click();
            console.log("已成功關閉彈窗");

        } catch (error) {
            // 如果 10 秒內沒出現，會進入這裡
            console.log("10 秒內未偵測到關閉按鈕，跳過此步驟。");
            return; // 直接結束 function
        }
    }

    async function addToCar() {
        try {
            await page.waitForSelector('[data-testid="add-to-cart-button"]', { visible: true, timeout: 10000 });
            await page.click('[data-testid="add-to-cart-button"]');
            console.log("已按下加入購物車按鈕");
        } catch (error) {
            console.error("找不到按鈕或按鈕無法點擊:", error.message);
        }
    }

    async function findItem(list, prompt) {
        const fuse = new Fuse(list, {
            includeScore: true,
            threshold: 0.4
        });

        const result = fuse.search(prompt);

        if (result.length > 0) {
            console.log('最匹配的是:', result[0].item); // 輸出: Apple
            console.log('相似度分數:', result[0].score);
            return result[0].item;
        } else {
            return null;
        }
    }

    async function main() {
        await clickCloseButton()
        let richText = await getRichText();
        for (const input of inputs) {
            let completedElements = []
            let inputFormmated = await findItem(richText, input[0]);
            await clickStoreItem(inputFormmated);
            await sleep(2000);
            let labels = await getLabelOptions()
            for (let i = 0; i < input[1].length; i++) {
                const inputDetail = input[1][i];
                const isLast = i === input[1].length - 1;
                console.log('inputDetail', inputDetail, isLast)
                let labelFormmated = await findItem(labels, inputDetail);
                const getPickOneItemResult = await getPickOneItem(labelFormmated, isLast, completedElements)
                if (getPickOneItemResult.status) {
                    console.log('已經push到completedElements')
                    completedElements.push(getPickOneItemResult.element)
                } else {
                    console.log('沒有push到completedElements')
                }
                await sleep(1000);
                await getPickManyItem(labelFormmated);
                await sleep(1000);
            }
            await sleep(2500);
            await addToCar();
            await clickCloseButton()
        }
    }

    try {
        await main();
        await browser.close();
        return true
    } catch (error) {
        console.error(error);
        return false
    }
}
