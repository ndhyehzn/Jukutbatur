import chalk from 'chalk';
import consoleStamp from 'console-stamp';
import ora from 'ora';
import { v4 as uuidV4 } from 'uuid';
import WebSocket from 'ws';
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import fs from 'fs';
import readline from 'readline';

let CoderMarkPrinted = false;

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l)'
});
process.setMaxListeners(0);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const getUnixTimestamp = () => Math.floor(Date.now() / 1000);
const PING_INTERVAL = 20 * 1000;
const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4444',
  'wss://proxy2.wynd.network:4650',
];

const randomUserAgent = () => {
  const userAgents = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.3",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.18 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const sleep = (ms) => {
  console.log('[SLEEP] sleeping for', ms, '...');
  return new Promise((resolve) => setTimeout(resolve, ms));
};

function getRandomInt(min, max) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}

class App {
  constructor(user, proxy, version = '4.29.0') {
    this.proxy = proxy;
    this.userId = user.id;
    this.version = version;
    this.browserId = null;
    this.websocket = null;
    this.userAgent = user.userAgent || randomUserAgent();
  }

  async start() {
    this.browserId ??= uuidV4();

    if (this.proxy) {
      console.info(`request with proxy: ${chalk.blue(this.proxy)}...`);
    }

    console.info(`Getting IP address...`, this.proxy);
    try {
      const ipAddress = await this.getIpAddress(this.proxy);
      console.info(`IP address: ${chalk.blue(ipAddress)}`);

      if (this.proxy && !ipAddress.includes(new URL(this.proxy).hostname)) {
        console.error(`[ERROR] Proxy IP address does not match! maybe the proxy is not working...`);
      }
    } catch (e) {
      console.error(`[ERROR] Could not get IP address! ${chalk.red(e)}`);
      return;
    }

    const websocketUrl = WEBSOCKET_URLS[getRandomInt(0, WEBSOCKET_URLS.length - 1)];

    const isWindows = this.userAgent.includes('Windows') || this.userAgent.includes('Win64') || this.userAgent.includes('Win32');

    let options = {
      headers: {
        "Pragma": "no-cache",
        "User-Agent": this.userAgent,
        OS: isWindows ? 'Windows' : 'Mac',
        Browser: 'Chrome',
        Platform: 'Desktop',
        "Sec-WebSocket-Version": "13",
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
        "Cache-Control": "no-cache",
        "priority": "u=1, i",
      },
      handshakeTimeout: 30000,
      rejectUnauthorized: false,
    };

    if (this.proxy) {
      console.log(`configuring websocket proxy agent...(${this.proxy})`);
      options.agent = await this.getProxyAgent(this.proxy);
      console.log('websocket proxy agent configured.');
    }

    this.websocket = new WebSocket(websocketUrl, options);

    this.websocket.on('open', async function (e) {
      console.log("[wss] Websocket connected!");
      this.sendPing();
    }.bind(this));

    this.websocket.on('message', async function (data) {
      console.log(`[wss] received message: ${chalk.blue(data)}`);

      let parsedMessage;
      try {
        parsedMessage = JSON.parse(data);
      } catch (e) {
        console.error(`[wss] Could not parse WebSocket message! ${chalk.red(data)}`);
        console.error(`[wss] ${chalk.red(e)}`);
        return;
      }

      switch (parsedMessage.action) {
        case 'AUTH':
          const message = JSON.stringify({
            id: parsedMessage.id,
            origin_action: parsedMessage.action,
            result: {
              browser_id: this.browserId,
              user_id: this.userId,
              user_agent: this.userAgent,
              timestamp: getUnixTimestamp(),
              device_type: "desktop",
              version: this.version,
            }
          });
          this.sendMessage(message);
          console.log(`[wss] (AUTH) message sent: ${chalk.green(message)}`);
          break;
        case 'PONG':
          console.log(`[wss] received pong: ${chalk.green(data)}`);
          break;
        default:
          console.error(`[wss] No RPC action ${chalk.red(parsedMessage.action)}!`);
          break;
      }
    }.bind(this));

    this.websocket.on('close', async function (code) {
      console.log(`[wss] Connection died: ${chalk.red(code)}`);
      setTimeout(() => {
        this.start();
      }, PING_INTERVAL);
    }.bind(this));

    this.websocket.on('error', function (error) {
      console.error(`[wss] ${error}`);
      this.websocket.terminate();

      setTimeout(() => {
        this.start();
      }, PING_INTERVAL);
    }.bind(this));
  }

  async sendPing() {
    setInterval(() => {
      const message = JSON.stringify({
        id: uuidV4(),
        version: '1.0.0',
        action: 'PING',
        data: {},
      });
      this.sendMessage(message);
      console.log(`[wss] send ping: ${chalk.green(message)}`);
    }, PING_INTERVAL);
  }

  async sendMessage(message) {
    if (this.websocket.readyState !== WebSocket.OPEN) {
      console.error(`[wss] WebSocket is not open!`);
      return;
    }

    this.websocket.send(message);
    console.log(`[wss] message sent: ${chalk.green(message)}`);
  }

  async getIpAddress(proxy) {
    let options = {};
    console.log(`[GET IP] Getting IP address...${proxy ? ` with proxy ${proxy}` : ''}`);

    if (proxy) {
      const agent = await this.getProxyAgent(proxy);
      console.log(`[GET IP] Using proxy agent...`);
      options.httpAgent = agent;
      options.httpsAgent = agent;
    }

    return await axios.get('https://ipinfo.io/json', options)
      .then(response => response.data.ip);
  }

  async getProxyAgent(proxy) {
    if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
      return new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith('socks://') || proxy.startsWith('socks5://')) {
      return new SocksProxyAgent(proxy);
    }

    throw new Error(`Unsupported proxy ${proxy}`);
  }
}

async function run(user, proxy) {
  const app = new App(user, proxy);

  const spinner = ora({ text: 'Loading…' }).start();
  let prefixText = `[user:${chalk.green(user.id.substring(-12))}]`;

  if (proxy) {
    const [ip, port] = new URL(proxy).host.split(':');
    prefixText += `[proxy:${chalk.green(ip)}:${chalk.green(port)}]`;
  }

  spinner.prefixText = prefixText;

  spinner.succeed(`Started!`);

  try {
    await app.start();
  } catch (e) {
    console.error(e);
    await app.start();
  }

  process.on('SIGINT', function () {
    console.log('Caught interrupt signal');
    spinner.stop();
    process.exit();
  });
}

const USER_ID = fs.readFileSync('uid.txt', 'utf-8').trim();

if (!USER_ID) {
  console.error('USER_ID not found in uid.txt');
  process.exit(1);
}

const USER = {
  id: USER_ID,
  userAgent: randomUserAgent()
};

const PROXIES = fs.readFileSync('proxy.txt').toString().split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);

console.info(`[${USER_ID}] Starting with user with ${PROXIES.length} proxies...`);

function CoderMark() {
    if (!CoderMarkPrinted) {
        console.log(`\n\n
╭━━━╮╱╱╱╱╱╱╱╱╱╱╱╱╱╭━━━┳╮
┃╭━━╯╱╱╱╱╱╱╱╱╱╱╱╱╱┃╭━━┫┃${chalk.green(`
┃╰━━┳╮╭┳━┳━━┳━━┳━╮┃╰━━┫┃╭╮╱╭┳━╮╭━╮`)}
┃╭━━┫┃┃┃╭┫╭╮┃╭╮┃╭╮┫╭━━┫┃┃┃╱┃┃╭╮┫╭╮╮${chalk.blue(`
┃┃╱╱┃╰╯┃┃┃╰╯┃╰╯┃┃┃┃┃╱╱┃╰┫╰━╯┃┃┃┃┃┃┃`)}
╰╯╱╱╰━━┻╯╰━╮┣━━┻╯╰┻╯╱╱╰━┻━╮╭┻╯╰┻╯╰╯${chalk.white(`
╱╱╱╱╱╱╱╱╱╱╱┃┃╱╱╱╱╱╱╱╱╱╱╱╭━╯┃
╱╱╱╱╱╱╱╱╱╱╱╰╯╱╱╱╱╱╱╱╱╱╱╱╰━━╯`)}
\n${chalk.green(`getGrass Minner Bot`)} ${chalk.white(`v0.3.1`)}`);
        CoderMarkPrinted = true;
    }
}

async function main() {
  CoderMark();
  rl.question(`\n\n${chalk.yellow('Choose run option:')}\n\n${chalk.red('1. Run directly (without proxy)')}\n${chalk.green('2. Run with proxy (proxy.txt)')}\n\nEnter your choice: `, async (answer) => {
    if (answer === '1') {
      await run(USER, null);
    } else if (answer === '2') {
      const promises = PROXIES.map(async proxy => {
        await sleep(getRandomInt(10, 6000));
        console.info(`[${USER.id}] Starting with proxy ${proxy}...`);
        await run(USER, proxy);
      });
      await Promise.all(promises);
    } else {
      console.log(chalk.red('Invalid option!'));
      rl.close();
    }
    rl.close();
  });
}

main().catch(console.error);

