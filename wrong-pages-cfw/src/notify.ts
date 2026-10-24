/**
 * Telegram 错误上报
 */

import { createHash } from 'crypto';
import { getStatusText, type PageContext } from './pages';

export interface TelegramEnv {
	TG_BOT_TOKEN?: string;
	TG_CHAT_ID?: string;
}

interface TelegramResponse {
	ok: boolean;
	description?: string;
	result?: { message_id: string };
}

export async function sendTelegramReport(
	context: PageContext,
	env: TelegramEnv
): Promise<string | undefined> {
	const botToken = env.TG_BOT_TOKEN;
	const chatId = env.TG_CHAT_ID;
	if (!botToken || !chatId) {
		return undefined;
	}

	const statusText = getStatusText(context.status);
	const domainShortHash = createHash('sha256').update(context.url.hostname).digest('hex').slice(0, 8);
	const userAgent = context.ua;
	// 从 userAgent 提取链接
	const userAgentLinks = userAgent.match(/https?:\/\/[^\s\)\]]+/g) || [];
	const { country, region, city, asOrg, asn } = context.geo;

	function formatLinks(links: string[]): string {
		if (links.length === 0) return '';
		let contents = '*相关链接:*\n';
		contents += links.map((link) => `- [${link}](${link})`).join('\n');
		return contents;
	}

	const message = `#${domainShortHash} CF错误报告
*错误代码:* ${context.status} ${statusText.en} | ${statusText.zh}
*请求地址:* ${context.url.href}
*请求时间:* ${context.time}

*Cloudflare事件ID:* ${context.ray}
*用户IP:* ${context.ip}
*用户信息:* ${country}/${region}/${city}/${asOrg}/${asn}
*用户代理:* ${userAgent.substring(0, 50)}${userAgent.length > 50 ? '...' : ''}
${formatLinks(userAgentLinks)}
`;

	try {
		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: message,
				parse_mode: 'Markdown',
				disable_web_page_preview: true,
			}),
		});
		const data = (await res.json()) as TelegramResponse;
		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description}`);
		}
		return data.result?.message_id;
	} catch (e) {
		console.error('Telegram report failed:', e);
		return undefined;
	}
}
