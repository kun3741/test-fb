require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const solver = require('2captcha');

const client = new solver.Solver(process.env.CAPTCHA_API_KEY);

(async () => {
    const browser = await puppeteer.launch({ headless: false, args: ["--disable-notifications"] });
    const page = await browser.newPage();

    const logStream = fs.createWriteStream('out.log', { flags: 'a' });
    const log = (message) => {
        logStream.write(`${new Date().toISOString()} - ${message}\n`);
    };

    try {
        log('Запуск браузера');
        await page.goto('https://www.facebook.com/');

        log('Вхід у Facebook');
        const email = process.env.FB_LOGIN;
        const password = process.env.FB_PASSWORD;

        await page.type('#email', email);
        await page.type('#pass', password);
        await page.click('button[name="login"]');

        log('Очікування авторизації або перевірки 2FA');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        if (page.url().includes('https://www.facebook.com/two_step_verification/two_factor/')) {
            log('2FA активовано. Очікуємо підтвердження...');
            const timeout = 180000;
            const interval = 5000;
            const startTime = Date.now();

            while (Date.now() - startTime < timeout) {
                log('Очікуємо підтвердження 2FA...');
                await new Promise(resolve => setTimeout(resolve, interval));

                const currentUrl = page.url();
                if (!currentUrl.includes('https://www.facebook.com/two_step_verification/two_factor/')) {
                    log('2FA успішно пройдено!');
                    break;
                }
            }

            if (page.url().includes('https://www.facebook.com/two_step_verification/two_factor/')) {
                throw new Error('Час очікування 2FA завершився, але підтвердження не отримано.');
            }
        }

        log('Перевірка наявності reCAPTCHA');
        const captchaFrame = await page.frames().find(frame => frame.url().includes('recaptcha'));
        if (captchaFrame) {
            log('Виявлено reCAPTCHA, вирішуємо...');

            const siteKey = await captchaFrame.evaluate(() => {
                const iframe = document.querySelector('iframe[src*="google.com/recaptcha/api2/anchor"]');
                const url = new URL(iframe.src);
                return url.searchParams.get('k');
            });

            const pageUrl = page.url();

            const captchaSolution = await client.recaptcha({
                googlekey: siteKey,
                pageurl: pageUrl,
            });

            log(`Капча вирішена! Токен: ${captchaSolution}`);

            await captchaFrame.evaluate((token) => {
                document.querySelector('#g-recaptcha-response').innerHTML = token;
            }, captchaSolution);

            log('Капча вирішена успішно.');
        }

        log('Перехід на сторінку профілю');
        await page.goto('https://www.facebook.com/me');

        log('Пошук div з класом та зображення');
        await page.waitForSelector('div.x1i10hfl.x1qjc9v5.xjbqb8w.xjqpnuy.xa49m3k.xqeqjp1.x2hbi6w.x13fuv20.xu3j5b3.x1q0q8m5.x26u7qi.x972fbf.xcfux6l.x1qhh985.xm0m39n.x9f619.x1ypdohk.xdl72j9.x2lah0s.xe8uvvx.xdj266r.x11i5rnm.xat24cr.x1mh8g0r.x2lwn1j.xeuugli.xexx8yu.x4uap5.x18d9i69.xkhd6sd.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1o1ewxj.x3x9cwd.x1e5q0jg.x13rtm0m.x1q0g3np.x87ps6o.x1lku1pv.x1a2a7pz.xzsf02u.x1rg5ohu');

        const avatarDivs = await page.$$('div.x1i10hfl.x1qjc9v5.xjbqb8w.xjqpnuy.xa49m3k.xqeqjp1.x2hbi6w.x13fuv20.xu3j5b3.x1q0q8m5.x26u7qi.x972fbf.xcfux6l.x1qhh985.xm0m39n.x9f619.x1ypdohk.xdl72j9.x2lah0s.xe8uvvx.xdj266r.x11i5rnm.xat24cr.x1mh8g0r.x2lwn1j.xeuugli.xexx8yu.x4uap5.x18d9i69.xkhd6sd.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1o1ewxj.x3x9cwd.x1e5q0jg.x13rtm0m.x1q0g3np.x87ps6o.x1lku1pv.x1a2a7pz.xzsf02u.x1rg5ohu');
        
        let avatarURL = null;

        for (const div of avatarDivs) {
            const image = await div.$('image');
            if (image) {
                const { width, height } = await page.evaluate(img => {
                    const style = window.getComputedStyle(img);
                    return {
                        width: parseInt(style.width),
                        height: parseInt(style.height)
                    };
                }, image);

                if (width === 168 && height === 168) {
                    avatarURL = await page.evaluate(img => img.href.baseVal, image);
                    break;
                }
            }
        }

        log(`URL аватару: ${avatarURL}`);

        log('Завантаження аватару');
        const viewSource = await page.goto(avatarURL);
        fs.writeFileSync('avatar.jpg', await viewSource.buffer());
        log('Фотографію профілю збережено.');
    } catch (error) {
        log(`Помилка: ${error.message}`);
    } finally {
        await browser.close();
        log('Браузер закрито');
        logStream.end();
    }
})();
